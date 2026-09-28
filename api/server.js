import { createPeerServer } from '../src/create-server.js';

const peer = await createPeerServer();

// Hobby rejects a value above 300. vercel.json must rewrite to /api/server
// with no path suffix; /api/server/$1 never reaches this file.
export const config = {
  maxDuration: 300
};

export default peer.httpServer;
