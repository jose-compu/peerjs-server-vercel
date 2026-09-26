import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { connect } from '../../support/client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function startProcess() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      REDIS_URL: '',
      UPSTASH_REDIS_URL: '',
      KV_URL: '',
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: '',
      PEERJS_KEY: 'peerjs',
      ALLOW_DISCOVERY: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`server did not listen\n${output}`));
    }, 5000);

    const watch = (chunk) => {
      output += chunk.toString();
      const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) {
        return;
      }
      clearTimeout(timer);
      resolve(Number(match[1]));
    };

    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code} before listening\n${output}`));
    });
  });

  return { child, ready };
}

describe('process e2e', () => {
  test('serves a PeerJS handshake and stops on SIGTERM', { timeout: 15_000 }, async () => {
    const { child, ready } = startProcess();
    let port = 0;
    let code = null;

    try {
      port = await ready;
      child.removeAllListeners('exit');

      const health = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(health.status, 200);
      assert.equal((await health.json()).status, 'ok');

      const aliceId = (await (await fetch(`http://127.0.0.1:${port}/peerjs/id`)).text()).trim();
      const bobId = (await (await fetch(`http://127.0.0.1:${port}/peerjs/id`)).text()).trim();
      assert.notEqual(aliceId, bobId);

      const alice = connect(port, { id: aliceId, token: 'tokenalice' });
      const bob = connect(port, { id: bobId, token: 'tokenbobbb' });
      await Promise.all([alice.opened, bob.opened]);
      assert.equal((await alice.messages.next()).type, 'OPEN');
      assert.equal((await bob.messages.next()).type, 'OPEN');

      const offerWait = bob.messages.next();
      alice.ws.send(JSON.stringify({
        type: 'OFFER',
        dst: bobId,
        payload: {
          sdp: { type: 'offer', sdp: 'v=0' },
          type: 'data',
          connectionId: 'dignity-conn',
          metadata: { app: 'dignity.js' }
        }
      }));
      const offer = await offerWait;
      assert.equal(offer.type, 'OFFER');
      assert.equal(offer.src, aliceId);
      assert.equal(offer.dst, bobId);
      assert.equal(offer.payload.metadata.app, 'dignity.js');

      const answerWait = alice.messages.next();
      bob.ws.send(JSON.stringify({
        type: 'ANSWER',
        dst: aliceId,
        payload: {
          sdp: { type: 'answer', sdp: 'v=0' },
          type: 'data',
          connectionId: 'dignity-conn'
        }
      }));
      const answer = await answerWait;
      assert.equal(answer.type, 'ANSWER');
      assert.equal(answer.src, bobId);

      const iceWait = bob.messages.next();
      alice.ws.send(JSON.stringify({
        type: 'CANDIDATE',
        dst: bobId,
        payload: {
          candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host', sdpMid: '0' },
          type: 'data',
          connectionId: 'dignity-conn'
        }
      }));
      const ice = await iceWait;
      assert.equal(ice.type, 'CANDIDATE');
      assert.equal(ice.src, aliceId);

      const clients = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal((await clients.json()).clients, 2);

      alice.ws.close();
      bob.ws.close();
    } finally {
      child.removeAllListeners('exit');
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        [code] = await exited;
      } else {
        code = child.exitCode;
      }
    }

    assert.equal(code, 0);
    assert.ok(port > 0);
  });
});
