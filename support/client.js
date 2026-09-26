import { WebSocket } from 'ws';
import { createPeerServer } from '../src/create-server.js';

export function track(ws) {
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

export function connect(port, { id, token, key = 'peerjs', path = '/peerjs' }) {
  const url = `ws://127.0.0.1:${port}${path}?key=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}&version=1.5.4`;
  const ws = new WebSocket(url);
  const messages = track(ws);
  const opened = new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  return { ws, messages, opened };
}

export async function start(options = {}) {
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
    upstashRestUrl: '',
    upstashRestToken: '',
    ...options
  });

  await new Promise((resolve) => {
    peer.httpServer.listen(0, '127.0.0.1', resolve);
  });

  return { peer, port: peer.httpServer.address().port };
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
