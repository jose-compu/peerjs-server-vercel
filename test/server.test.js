import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { WebSocket } from 'ws';
import { createPeerServer } from '../src/create-server.js';
import { MemoryDirectory } from '../src/directory.js';
import { createMemoryRelay } from '../src/relay.js';

function track(ws) {
  const messages = [];
  let waiter = null;
  let timer = null;

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (!waiter) {
      messages.push(message);
      return;
    }

    clearTimeout(timer);
    const resolve = waiter;
    waiter = null;
    resolve(message);
  });

  return {
    next(timeoutMs = 2000) {
      if (messages.length > 0) {
        return Promise.resolve(messages.shift());
      }

      return new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          waiter = null;
          reject(new Error(`timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        waiter = resolve;
      });
    }
  };
}

function connect(port, { id, token, key = 'peerjs', path = '/peerjs' }) {
  const url = `ws://127.0.0.1:${port}${path}?key=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}&version=1.5.4`;
  const ws = new WebSocket(url);
  const messages = track(ws);
  const opened = new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  return { ws, messages, opened };
}

async function start(options = {}) {
  const peer = await createPeerServer({
    key: 'peerjs',
    path: '/',
    aliveTimeout: 90_000,
    expireTimeout: 5_000,
    cleanupIntervalMs: 60_000,
    aliveCheckIntervalMs: 60_000,
    concurrentLimit: 100,
    allowDiscovery: false,
    redisUrl: '',
    ...options
  });

  await new Promise((resolve) => {
    peer.httpServer.listen(0, '127.0.0.1', resolve);
  });

  const address = peer.httpServer.address();
  return { peer, port: address.port };
}

async function closed(ws, timeoutMs = 1500) {
  if (ws.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('peerjs signaling server', () => {
  test('serves health, server info, and a peer id', async () => {
    const server = await start();

    try {
      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      assert.equal(health.status, 200);
      const healthBody = await health.json();
      assert.equal(healthBody.status, 'ok');
      assert.equal(healthBody.redis, false);

      const info = await fetch(`http://127.0.0.1:${server.port}/`);
      assert.equal(info.status, 200);
      const infoBody = await info.json();
      assert.equal(infoBody.name, 'peerjs-server-vercel');

      const idResponse = await fetch(`http://127.0.0.1:${server.port}/peerjs/id`, {
        headers: { Origin: 'https://example.test' }
      });
      assert.equal(idResponse.status, 200);
      assert.equal(idResponse.headers.get('access-control-allow-origin'), 'https://example.test');
      const peerId = (await idResponse.text()).trim();
      assert.match(peerId, /^[0-9a-f-]{36}$/);

      const prefixed = await fetch(`http://127.0.0.1:${server.port}/api/server/peerjs/id`);
      assert.equal(prefixed.status, 200);
      assert.match((await prefixed.text()).trim(), /^[0-9a-f-]{36}$/);

      const missing = await fetch(`http://127.0.0.1:${server.port}/missing`);
      assert.equal(missing.status, 404);
    } finally {
      await server.peer.close();
    }
  });

  test('hides the peer list unless discovery is enabled', async () => {
    const hidden = await start();

    try {
      const response = await fetch(`http://127.0.0.1:${hidden.port}/peerjs/peers`);
      assert.equal(response.status, 401);
    } finally {
      await hidden.peer.close();
    }

    const shown = await start({ allowDiscovery: true });

    try {
      const alice = connect(shown.port, { id: 'alice', token: 'tokenalice' });
      await alice.opened;
      assert.equal((await alice.messages.next()).type, 'OPEN');

      const response = await fetch(`http://127.0.0.1:${shown.port}/peerjs/peers`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), ['alice']);
      alice.ws.terminate();
    } finally {
      await shown.peer.close();
    }
  });

  test('opens a socket and relays an offer with the authenticated source', async () => {
    const server = await start();

    try {
      const alice = connect(server.port, { id: 'alice', token: 'tokenalice' });
      const bob = connect(server.port, { id: 'bob', token: 'tokenbobbb' });
      await Promise.all([alice.opened, bob.opened]);
      assert.equal((await alice.messages.next()).type, 'OPEN');
      assert.equal((await bob.messages.next()).type, 'OPEN');

      const incoming = bob.messages.next();
      alice.ws.send(JSON.stringify({
        type: 'OFFER',
        src: 'intruder',
        dst: 'bob',
        payload: { sdp: 'offer-sdp' }
      }));

      const offer = await incoming;
      assert.equal(offer.type, 'OFFER');
      assert.equal(offer.src, 'alice');
      assert.equal(offer.dst, 'bob');
      assert.deepEqual(offer.payload, { sdp: 'offer-sdp' });
    } finally {
      await server.peer.close();
    }
  });

  test('queues an offer until the destination connects', async () => {
    const server = await start();

    try {
      const alice = connect(server.port, { id: 'alice', token: 'tokenalice' });
      await alice.opened;
      assert.equal((await alice.messages.next()).type, 'OPEN');

      alice.ws.send(JSON.stringify({
        type: 'OFFER',
        dst: 'bob',
        payload: { sdp: 'queued' }
      }));

      await new Promise((resolve) => setTimeout(resolve, 50));

      const bob = connect(server.port, { id: 'bob', token: 'tokenbobbb' });
      await bob.opened;
      assert.equal((await bob.messages.next()).type, 'OPEN');
      const offer = await bob.messages.next();
      assert.equal(offer.type, 'OFFER');
      assert.equal(offer.src, 'alice');
      assert.deepEqual(offer.payload, { sdp: 'queued' });
    } finally {
      await server.peer.close();
    }
  });

  test('rejects a second token and a bad key', async () => {
    const server = await start();

    try {
      const alice = connect(server.port, { id: 'alice', token: 'tokenalice' });
      await alice.opened;
      assert.equal((await alice.messages.next()).type, 'OPEN');

      const stolen = connect(server.port, { id: 'alice', token: 'othertoken' });
      await stolen.opened;
      const taken = await stolen.messages.next();
      assert.equal(taken.type, 'ID-TAKEN');
      await closed(stolen.ws);

      const wrongKey = connect(server.port, { id: 'carol', token: 'tokencarol', key: 'nope' });
      await wrongKey.opened;
      const error = await wrongKey.messages.next();
      assert.equal(error.type, 'ERROR');
      assert.equal(error.payload.msg, 'Invalid key provided');
    } finally {
      await server.peer.close();
    }
  });

  test('rejects sockets that omit id or token', async () => {
    const server = await start();

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/peerjs?key=peerjs`);
      const messages = track(ws);
      await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      const error = await messages.next();
      assert.equal(error.type, 'ERROR');
      assert.match(error.payload.msg, /No id, token, or key/);
    } finally {
      await server.peer.close();
    }
  });

  test('enforces the concurrent connection limit', async () => {
    const server = await start({ concurrentLimit: 1 });

    try {
      const alice = connect(server.port, { id: 'alice', token: 'tokenalice' });
      await alice.opened;
      assert.equal((await alice.messages.next()).type, 'OPEN');

      const bob = connect(server.port, { id: 'bob', token: 'tokenbobbb' });
      await bob.opened;
      const error = await bob.messages.next();
      assert.equal(error.type, 'ERROR');
      assert.match(error.payload.msg, /concurrent user limit/);
    } finally {
      await server.peer.close();
    }
  });

  test('expires a queued offer and drops idle peers', async () => {
    const server = await start({
      expireTimeout: 80,
      cleanupIntervalMs: 30,
      aliveTimeout: 200,
      aliveCheckIntervalMs: 40
    });

    try {
      const alice = connect(server.port, { id: 'alice', token: 'tokenalice' });
      await alice.opened;
      assert.equal((await alice.messages.next()).type, 'OPEN');
      alice.ws.send(JSON.stringify({
        type: 'OFFER',
        dst: 'missing1',
        payload: { sdp: 'late' }
      }));

      const expired = await alice.messages.next(1000);
      assert.equal(expired.type, 'EXPIRE');
      assert.equal(expired.src, 'missing1');
      assert.equal(expired.dst, 'alice');

      await closed(alice.ws, 1000);
    } finally {
      await server.peer.close();
    }
  });

  test('keeps a peer online while heartbeats arrive', async () => {
    const server = await start({
      aliveTimeout: 220,
      aliveCheckIntervalMs: 40
    });

    try {
      const alice = connect(server.port, { id: 'alice', token: 'tokenalice' });
      await alice.opened;
      assert.equal((await alice.messages.next()).type, 'OPEN');

      const timer = setInterval(() => {
        if (alice.ws.readyState === WebSocket.OPEN) {
          alice.ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
        }
      }, 70);

      await new Promise((resolve) => setTimeout(resolve, 700));
      clearInterval(timer);
      assert.equal(alice.ws.readyState, WebSocket.OPEN);
    } finally {
      await server.peer.close();
    }
  });

  test('uses a custom key and base path', async () => {
    const server = await start({ key: 'secret', path: '/app' });

    try {
      const idResponse = await fetch(`http://127.0.0.1:${server.port}/app/secret/id`);
      assert.equal(idResponse.status, 200);

      const alice = connect(server.port, {
        id: 'alice',
        token: 'tokenalice',
        key: 'secret',
        path: '/app/peerjs'
      });
      await alice.opened;
      assert.equal((await alice.messages.next()).type, 'OPEN');
    } finally {
      await server.peer.close();
    }
  });

  test('refuses upgrades that are not the peerjs socket', async () => {
    const server = await start();

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/nope`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out')), 2000);
        const finish = () => {
          clearTimeout(timer);
          resolve();
        };
        ws.once('error', finish);
        ws.once('close', finish);
        ws.once('open', () => {
          clearTimeout(timer);
          reject(new Error('upgrade opened'));
        });
      });
    } finally {
      await server.peer.close();
    }
  });

  test('relays an offer between two server instances', async () => {
    const directory = new MemoryDirectory();
    const relay = createMemoryRelay();
    const left = await start({ directory, relay });
    const right = await start({ directory, relay });

    try {
      const alice = connect(left.port, { id: 'alice', token: 'tokenalice' });
      const bob = connect(right.port, { id: 'bob', token: 'tokenbobbb' });
      await Promise.all([alice.opened, bob.opened]);
      assert.equal((await alice.messages.next()).type, 'OPEN');
      assert.equal((await bob.messages.next()).type, 'OPEN');

      const incoming = bob.messages.next();
      alice.ws.send(JSON.stringify({
        type: 'ANSWER',
        src: 'intruder',
        dst: 'bob',
        payload: { sdp: 'answer-sdp' }
      }));

      const answer = await incoming;
      assert.equal(answer.type, 'ANSWER');
      assert.equal(answer.src, 'alice');
      assert.equal(answer.dst, 'bob');
      assert.deepEqual(answer.payload, { sdp: 'answer-sdp' });
    } finally {
      await left.peer.close();
      await right.peer.close();
    }
  });
});
