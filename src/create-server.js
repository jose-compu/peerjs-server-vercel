import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import Redis from 'ioredis';
import { Errors, ID_PATTERN, MessageType, RELAY_TYPES } from './constants.js';
import { configFromEnv } from './config.js';
import { MemoryDirectory, RedisDirectory } from './directory.js';
import { idPath, logicalPath, peersPath, socketPath } from './paths.js';
import { InboxRelay, RedisRelay } from './relay.js';
import { createUpstashClient } from './upstash-client.js';

function sendJson(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  socket.send(JSON.stringify(message));
  return true;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function writeText(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function validId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function waitReady(client) {
  if (client.status === 'ready') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onReady = () => {
      client.off('error', onError);
      resolve();
    };
    const onError = (error) => {
      client.off('ready', onReady);
      reject(error);
    };
    client.once('ready', onReady);
    client.once('error', onError);
  });
}

function createRedisClient(url, { subscriber = false } = {}) {
  const client = new Redis(url, {
    maxRetriesPerRequest: subscriber ? null : 1,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 4_000,
    retryStrategy: () => null
  });
  client.on('error', () => {
    console.error('Redis connection error');
  });
  return client;
}

export async function createPeerServer(options = {}) {
  const config = {
    ...configFromEnv(),
    ...options
  };

  const instanceId = randomUUID();
  const sockets = new Map();
  let directory = options.directory ?? null;
  let relay = options.relay ?? null;
  let unsubscribe = () => {};
  let ownsRedis = false;
  let redisClients = [];
  let redisMode = 'memory';

  if (!directory && !options.relay && config.redisUrl) {
    const publisher = createRedisClient(config.redisUrl);
    const subscriber = createRedisClient(config.redisUrl, { subscriber: true });
    try {
      await publisher.connect();
      await subscriber.connect();
      await Promise.all([waitReady(publisher), waitReady(subscriber)]);
      directory = new RedisDirectory(publisher, config);
      relay = new RedisRelay(publisher, subscriber, instanceId);
      await relay.start();
      ownsRedis = true;
      redisMode = 'tcp';
      redisClients = [publisher, subscriber];
    } catch (error) {
      publisher.disconnect();
      subscriber.disconnect();
      if (!config.upstashRestUrl || !config.upstashRestToken) {
        throw error;
      }
      console.error('Redis TCP connection failed; using the Upstash REST relay');
    }
  }

  if (!directory && !options.relay && config.upstashRestUrl && config.upstashRestToken) {
    const client = createUpstashClient(config.upstashRestUrl, config.upstashRestToken);
    directory = new RedisDirectory(client, config);
    relay = new InboxRelay(client, instanceId, {
      pollMs: config.relayPollMs,
      hasWork: () => sockets.size > 0
    });
    await relay.start();
    ownsRedis = true;
    redisMode = 'upstash';
  }

  if (!directory) {
    directory = new MemoryDirectory();
  }

  if (relay) {
    unsubscribe = relay.subscribe((event) => {
      if (!event || event.origin === instanceId) {
        return;
      }

      if (event.kind === 'kick') {
        const current = sockets.get(event.id);
        if (current && current.generation < event.generation) {
          current.socket.close();
        }
        return;
      }

      if (event.kind === 'signal') {
        deliverLocal(event.message);
      }
    });
  }

  function deliverLocal(message) {
    if (!message?.dst) {
      return false;
    }

    const destination = sockets.get(message.dst);
    if (!destination) {
      return false;
    }

    try {
      return sendJson(destination.socket, message);
    } catch (error) {
      destination.socket.close();
      return false;
    }
  }

  async function forward(message) {
    if (!message?.dst) {
      return;
    }

    if (deliverLocal(message)) {
      return;
    }

    const ownedHere = sockets.has(message.dst);
    if (!ownedHere && relay && (await directory.has(message.dst))) {
      await relay.publish({
        kind: 'signal',
        origin: instanceId,
        message
      });
      return;
    }

    if (message.type !== MessageType.LEAVE && message.type !== MessageType.EXPIRE) {
      await directory.enqueue(message.dst, message);
    }
  }

  async function expireQueued() {
    if (sockets.size === 0) {
      return;
    }

    const expired = await directory.collectExpired(Date.now(), config.expireTimeout);
    const seen = new Set();

    for (const message of expired) {
      if (!message?.src || !message?.dst) {
        continue;
      }

      const pair = `${message.src}:${message.dst}`;
      if (seen.has(pair)) {
        continue;
      }
      seen.add(pair);

      await forward({
        type: MessageType.EXPIRE,
        src: message.dst,
        dst: message.src
      });
    }
  }

  function checkAlive() {
    const now = Date.now();
    for (const client of sockets.values()) {
      if (now - client.lastPing >= config.aliveTimeout) {
        client.socket.close();
      }
    }
  }

  async function handleHttp(req, res) {
    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      writeJson(res, 404, { error: 'Not found' });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = logicalPath(url.pathname);

    if (pathname === '/health') {
      writeJson(res, 200, {
        status: 'ok',
        clients: await directory.count(),
        redis: redisMode !== 'memory',
        redisMode
      });
      return;
    }

    if (pathname === '/') {
      writeJson(res, 200, {
        name: 'peerjs-server-vercel',
        description: 'PeerJS signaling server for Vercel and Node.',
        website: 'https://peerjs.com/'
      });
      return;
    }

    if (pathname === idPath(config.path, config.key)) {
      let clientId = randomUUID();
      while (await directory.has(clientId)) {
        clientId = randomUUID();
      }
      writeText(res, 200, clientId);
      return;
    }

    if (pathname === peersPath(config.path, config.key)) {
      if (!config.allowDiscovery) {
        res.writeHead(401, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      writeJson(res, 200, await directory.ids());
      return;
    }

    writeJson(res, 404, { error: 'Not found' });
  }

  async function registerSocket(socket, id, token) {
    const now = Date.now();
    const existing = await directory.get(id);

    if (existing && existing.token !== token) {
      sendJson(socket, {
        type: MessageType.ID_TAKEN,
        payload: { msg: 'ID is taken' }
      });
      socket.close();
      return;
    }

    if (!existing && (await directory.count()) >= config.concurrentLimit) {
      sendJson(socket, {
        type: MessageType.ERROR,
        payload: { msg: Errors.CONNECTION_LIMIT_EXCEED }
      });
      socket.close();
      return;
    }

    const claim = await directory.claim(id, token, now, config.aliveTimeout);
    if (!claim.ok) {
      sendJson(socket, {
        type: MessageType.ID_TAKEN,
        payload: { msg: 'ID is taken' }
      });
      socket.close();
      return;
    }

    const previous = sockets.get(id);
    if (previous) {
      sockets.delete(id);
      previous.socket.close();
    }

    const client = {
      id,
      token,
      generation: claim.generation,
      lastPing: now,
      lastDirectoryTouch: now,
      socket
    };
    sockets.set(id, client);
    if (typeof relay?.poll === 'function') {
      relay.poll().catch(() => {
        console.error('Inbox relay poll failed');
      });
    }

    if (claim.generation > 1 && relay) {
      await relay.publish({
        kind: 'kick',
        origin: instanceId,
        id,
        generation: claim.generation
      });
    }

    socket.on('close', () => {
      const current = sockets.get(id);
      if (current?.socket !== socket) {
        return;
      }

      sockets.delete(id);
      directory.removeIfGeneration(id, client.generation).catch(() => {
        console.error('Failed to remove peer registration');
      });
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        return;
      }

      const raw = typeof data === 'string' ? data : data.toString();
      if (Buffer.byteLength(raw) > config.maxMessageBytes) {
        socket.close();
        return;
      }

      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        return;
      }

      onClientMessage(client, message).catch(() => {
        console.error('Failed to handle signaling message');
      });
    });

    sendJson(socket, { type: MessageType.OPEN });

    const queued = await directory.drain(id);
    for (const message of queued) {
      sendJson(socket, message);
    }
  }

  async function onClientMessage(client, message) {
    if (!message || typeof message.type !== 'string') {
      return;
    }

    if (message.type === MessageType.HEARTBEAT) {
      client.lastPing = Date.now();
      if (client.lastPing - client.lastDirectoryTouch >= config.presenceTouchMs) {
        client.lastDirectoryTouch = client.lastPing;
        await directory.touch(client.id, client.generation, client.lastPing, config.aliveTimeout);
      }
      return;
    }

    if (!RELAY_TYPES.has(message.type)) {
      return;
    }

    if (message.dst !== undefined && message.dst !== null && !validId(message.dst)) {
      return;
    }

    const outbound = {
      type: message.type,
      src: client.id,
      dst: message.dst
    };

    if (message.payload !== undefined) {
      outbound.payload = message.payload;
    }

    await forward(outbound);
  }

  function rejectSocket(socket, msg) {
    sendJson(socket, {
      type: MessageType.ERROR,
      payload: { msg }
    });
    socket.close();
  }

  const httpServer = createServer((req, res) => {
    handleHttp(req, res).catch(() => {
      if (!res.headersSent) {
        writeJson(res, 500, { error: 'Internal error' });
      } else {
        res.end();
      }
    });
  });

  httpServer.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch (error) {
      socket.destroy();
      return;
    }

    if (logicalPath(url.pathname) !== socketPath(config.path)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (socket, req) => {
    socket.on('error', () => {
      socket.close();
    });

    let url;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch (error) {
      rejectSocket(socket, Errors.INVALID_WS_PARAMETERS);
      return;
    }

    const id = url.searchParams.get('id');
    const token = url.searchParams.get('token');
    const key = url.searchParams.get('key');

    if (!validId(id) || !validId(token) || !key) {
      rejectSocket(socket, Errors.INVALID_WS_PARAMETERS);
      return;
    }

    if (key !== config.key) {
      rejectSocket(socket, Errors.INVALID_KEY);
      return;
    }

    registerSocket(socket, id, token).catch(() => {
      console.error('Failed to register peer');
      socket.close();
    });
  });

  const cleanupTimer = setInterval(() => {
    expireQueued().catch(() => {
      console.error('Failed to expire queued signaling messages');
    });
  }, config.cleanupIntervalMs);
  cleanupTimer.unref?.();

  const aliveTimer = setInterval(checkAlive, config.aliveCheckIntervalMs);
  aliveTimer.unref?.();

  async function close() {
    clearInterval(cleanupTimer);
    clearInterval(aliveTimer);
    unsubscribe();

    for (const client of [...sockets.values()]) {
      client.socket.terminate();
    }
    sockets.clear();

    await new Promise((resolve) => {
      wss.close(() => resolve());
    });

    if (httpServer.listening) {
      httpServer.closeAllConnections?.();
      await new Promise((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }

    if (ownsRedis) {
      await relay.close();
      for (const client of redisClients) {
        if (client.status !== 'end') {
          client.disconnect();
        }
      }
    }
  }

  return {
    httpServer,
    directory,
    close
  };
}

export { configFromEnv };
