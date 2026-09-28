import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { WebSocket } from 'ws';
import { MemoryDirectory } from '../../src/directory.js';
import { createMemoryRelay } from '../../src/relay.js';
import { connect, delay, start } from '../../support/client.js';

class CountingDirectory extends MemoryDirectory {
  constructor() {
    super();
    this.touches = 0;
  }

  async touch(...args) {
    this.touches += 1;
    return super.touch(...args);
  }
}

async function openPeer(port, id, token = `${id}token`) {
  const peer = connect(port, { id, token });
  await peer.opened;
  assert.equal((await peer.messages.next()).type, 'OPEN');
  return peer;
}

describe('signaling integration', () => {
  test('refreshes shared presence on a slow heartbeat cadence', async () => {
    const directory = new CountingDirectory();
    const server = await start({ directory, presenceTouchMs: 120 });

    try {
      const alice = await openPeer(server.port, 'alice');
      alice.ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
      await delay(30);
      alice.ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
      await delay(30);
      assert.equal(directory.touches, 0);

      await delay(120);
      alice.ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
      await delay(30);
      assert.equal(directory.touches, 1);
    } finally {
      await server.peer.close();
    }
  });

  test('completes an offer, answer, and candidate exchange', async () => {
    const server = await start();

    try {
      const alice = await openPeer(server.port, 'alice');
      const bob = await openPeer(server.port, 'bob');

      const bobOffer = bob.messages.next();
      alice.ws.send(JSON.stringify({
        type: 'OFFER',
        src: 'intruder',
        dst: 'bob',
        payload: {
          sdp: { type: 'offer', sdp: 'v=0' },
          type: 'data',
          connectionId: 'conn-1'
        }
      }));
      const offer = await bobOffer;
      assert.equal(offer.src, 'alice');
      assert.equal(offer.payload.connectionId, 'conn-1');

      const aliceAnswer = alice.messages.next();
      bob.ws.send(JSON.stringify({
        type: 'ANSWER',
        dst: 'alice',
        payload: { sdp: { type: 'answer', sdp: 'v=0' }, connectionId: 'conn-1' }
      }));
      const answer = await aliceAnswer;
      assert.equal(answer.type, 'ANSWER');
      assert.equal(answer.src, 'bob');

      const bobIce = bob.messages.next();
      alice.ws.send(JSON.stringify({
        type: 'CANDIDATE',
        dst: 'bob',
        payload: { candidate: { candidate: 'candidate:1' }, connectionId: 'conn-1' }
      }));
      const ice = await bobIce;
      assert.equal(ice.type, 'CANDIDATE');
      assert.equal(ice.src, 'alice');
      assert.equal(ice.payload.candidate.candidate, 'candidate:1');
    } finally {
      await server.peer.close();
    }
  });

  test('ignores invalid frames and still relays the next candidate', async () => {
    const server = await start();

    try {
      const alice = await openPeer(server.port, 'alice');
      const bob = await openPeer(server.port, 'bob');
      const incoming = bob.messages.next();

      alice.ws.send('not-json');
      alice.ws.send(Buffer.from([1, 2, 3]));
      alice.ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
      alice.ws.send(JSON.stringify({ type: 'NOPE', dst: 'bob', payload: { n: 1 } }));
      alice.ws.send(JSON.stringify({ type: 'OFFER', dst: 'bad id', payload: { n: 2 } }));
      alice.ws.send(JSON.stringify({ type: 'LEAVE' }));
      alice.ws.send(JSON.stringify({
        type: 'CANDIDATE',
        dst: 'bob',
        payload: { candidate: { candidate: 'candidate:2' } }
      }));

      const message = await incoming;
      assert.equal(message.type, 'CANDIDATE');
      assert.equal(message.payload.candidate.candidate, 'candidate:2');
      assert.equal(alice.ws.readyState, WebSocket.OPEN);
    } finally {
      await server.peer.close();
    }
  });

  test('closes a socket that sends an oversized frame', async () => {
    const server = await start({ maxMessageBytes: 48 });

    try {
      const alice = await openPeer(server.port, 'alice');
      alice.ws.send(JSON.stringify({ type: 'HEARTBEAT', payload: 'x'.repeat(80) }));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket stayed open')), 1500);
        alice.ws.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } finally {
      await server.peer.close();
    }
  });

  test('rejects malformed ids and accepts a trailing-slash socket', async () => {
    const server = await start();

    try {
      const bad = connect(server.port, { id: 'bad/id', token: 'tokentoken' });
      await bad.opened;
      const error = await bad.messages.next();
      assert.equal(error.type, 'ERROR');
      assert.match(error.payload.msg, /No id, token, or key/);

      const alice = connect(server.port, {
        id: 'alice',
        token: 'alicetoken',
        path: '/peerjs/'
      });
      await alice.opened;
      assert.equal((await alice.messages.next()).type, 'OPEN');

      const prefixed = connect(server.port, {
        id: 'bob',
        token: 'bobtoken',
        path: '/api/server/peerjs'
      });
      await prefixed.opened;
      assert.equal((await prefixed.messages.next()).type, 'OPEN');
    } finally {
      await server.peer.close();
    }
  });

  test('serves CORS preflight, unique ids, and a no-store id response', async () => {
    const server = await start();

    try {
      const preflight = await fetch(`http://127.0.0.1:${server.port}/peerjs/id`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.test' }
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.test');

      const posted = await fetch(`http://127.0.0.1:${server.port}/peerjs/id`, { method: 'POST' });
      assert.equal(posted.status, 404);

      const first = await fetch(`http://127.0.0.1:${server.port}/peerjs/id/`);
      const second = await fetch(`http://127.0.0.1:${server.port}/api/server/peerjs/id`);
      assert.equal(first.headers.get('cache-control'), 'no-store');
      const firstId = (await first.text()).trim();
      const secondId = (await second.text()).trim();
      assert.notEqual(firstId, secondId);
      assert.match(firstId, /^[0-9a-f-]{36}$/);
    } finally {
      await server.peer.close();
    }
  });

  test('removes a disconnected peer from discovery', async () => {
    const server = await start({ allowDiscovery: true });

    try {
      const alice = await openPeer(server.port, 'alice');
      const bob = await openPeer(server.port, 'bob');
      const before = await fetch(`http://127.0.0.1:${server.port}/peerjs/peers`);
      assert.deepEqual((await before.json()).sort(), ['alice', 'bob']);

      alice.ws.terminate();
      let remaining = [];
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const response = await fetch(`http://127.0.0.1:${server.port}/peerjs/peers`);
        remaining = await response.json();
        if (remaining.length === 1) {
          break;
        }
        await delay(15);
      }
      assert.deepEqual(remaining, ['bob']);
      bob.ws.close();
    } finally {
      await server.peer.close();
    }
  });

  test('sends OPEN again when the same token reconnects', async () => {
    const server = await start();

    try {
      const first = await openPeer(server.port, 'alice', 'same-token');
      const second = connect(server.port, { id: 'alice', token: 'same-token' });
      await second.opened;
      assert.equal((await second.messages.next()).type, 'OPEN');
      await delay(50);
      assert.equal(first.ws.readyState, WebSocket.CLOSED);
      second.ws.close();
    } finally {
      await server.peer.close();
    }
  });

  test('replaces the same token when the server is already full', async () => {
    const server = await start({ concurrentLimit: 1 });

    try {
      const first = await openPeer(server.port, 'alice', 'same-token');
      const second = connect(server.port, { id: 'alice', token: 'same-token' });
      await second.opened;
      await delay(50);

      assert.equal(first.ws.readyState, WebSocket.CLOSED);
      assert.equal(second.ws.readyState, WebSocket.OPEN);

      const bob = connect(server.port, { id: 'bob', token: 'bob-token' });
      await bob.opened;
      const error = await bob.messages.next();
      assert.equal(error.type, 'ERROR');
    } finally {
      await server.peer.close();
    }
  });

  test('moves a peer to another instance and delivers the queued offer there', async () => {
    const directory = new MemoryDirectory();
    const relay = createMemoryRelay();
    const left = await start({ directory, relay });
    const right = await start({ directory, relay });

    try {
      const alice = await openPeer(left.port, 'alice', 'alice-token');
      alice.ws.send(JSON.stringify({
        type: 'OFFER',
        dst: 'bob',
        payload: { sdp: 'queued-across' }
      }));
      await delay(30);

      const moved = connect(right.port, { id: 'alice', token: 'alice-token' });
      await moved.opened;
      await delay(30);
      assert.equal(alice.ws.readyState, WebSocket.CLOSED);
      assert.equal((await moved.messages.next()).type, 'OPEN');

      const bob = connect(right.port, { id: 'bob', token: 'bob-token' });
      await bob.opened;
      assert.equal((await bob.messages.next()).type, 'OPEN');
      const offer = await bob.messages.next();
      assert.equal(offer.type, 'OFFER');
      assert.equal(offer.src, 'alice');
      assert.equal(offer.payload.sdp, 'queued-across');

      const incoming = moved.messages.next();
      bob.ws.send(JSON.stringify({
        type: 'CANDIDATE',
        dst: 'alice',
        payload: { candidate: { candidate: 'after-move' } }
      }));
      const ice = await incoming;
      assert.equal(ice.type, 'CANDIDATE');
      assert.equal(ice.src, 'bob');
    } finally {
      await left.peer.close();
      await right.peer.close();
    }
  });
});
