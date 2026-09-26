import { createPeerServer } from '../src/create-server.js';

const peer = await createPeerServer();

export const config = {
  maxDuration: 300
};

export default peer.httpServer;
