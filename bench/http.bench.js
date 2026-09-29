import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, bench, describe } from 'vitest';
import { createPeerServer } from '../src/create-server.js';

// Drives the HTTP request handler with in-process request/response objects,
// so the routing and response logic is measured without real sockets.
class FakeResponse extends EventEmitter {
  constructor(resolve) {
    super();
    this.headers = {};
    this.headersSent = false;
    this.statusCode = 200;
    this.body = '';
    this.resolve = resolve;
  }

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }

  writeHead(status, headers = {}) {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) {
      this.setHeader(name, value);
    }
    this.headersSent = true;
    return this;
  }

  end(body = '') {
    this.body = body;
    this.resolve(this);
  }
}

let server;

function request(method, url, origin) {
  return new Promise((resolve) => {
    const req = { method, url, headers: origin ? { origin } : {} };
    server.httpServer.emit('request', req, new FakeResponse(resolve));
  });
}

beforeAll(async () => {
  server = await createPeerServer({
    key: 'peerjs',
    path: '/',
    allowDiscovery: true,
    redisUrl: '',
    upstashRestUrl: '',
    upstashRestToken: ''
  });
  for (let index = 0; index < 100; index += 1) {
    await server.directory.claim(`peer-${index}`, `token-${index}`, Date.now(), 90_000);
  }
});

afterAll(async () => {
  await server?.close();
});

describe('HTTP routes', () => {
  bench('GET /peerjs/id', async () => {
    await request('GET', '/peerjs/id', 'https://app.example.com');
  });

  bench('GET /health', async () => {
    await request('GET', '/api/server/health');
  });

  bench('GET /peerjs/peers with 100 peers', async () => {
    await request('GET', '/peerjs/peers');
  });

  bench('mixed routes (root, OPTIONS, 404, POST)', async () => {
    await request('GET', '/');
    await request('OPTIONS', '/peerjs/id', 'https://app.example.com');
    await request('GET', '/does/not/exist');
    await request('POST', '/peerjs/id');
  });
});
