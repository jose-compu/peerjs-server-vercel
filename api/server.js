import { createPeerServer } from '../src/create-server.js';

const peer = await createPeerServer();

export default peer.httpServer;
