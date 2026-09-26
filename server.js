#!/usr/bin/env node
import { configFromEnv, createPeerServer } from './src/create-server.js';

const config = configFromEnv();
const peer = await createPeerServer(config);
const port = Number(process.env.PORT || 9000);
const host = process.env.HOST || '0.0.0.0';

peer.httpServer.listen(port, host, () => {
  const boundPort = peer.httpServer.address().port;
  console.log(`peerjs-server-vercel listening on http://${host}:${boundPort}`);
  console.log(`signaling url: ws://${host}:${boundPort}/peerjs?key=${config.key}`);
});

async function shutdown() {
  await peer.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
