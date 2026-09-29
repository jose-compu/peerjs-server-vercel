import { bench, describe } from 'vitest';
import { idPath, joinBase, logicalPath, normalizeBase, peersPath, socketPath } from '../src/paths.js';

const REQUEST_PATHS = [
  '/',
  '/health',
  '/peerjs',
  '/peerjs/id',
  '/peerjs/peers',
  '/api/server',
  '/api/server/',
  '/api/server/health',
  '/api/server/peerjs/id',
  '/api/server/api/server/peerjs/peers/',
  'peerjs/id/',
  '/some/unknown/route/'
];

const BASES = ['/', '', 'signal', '/signal/', '/nested/base/', undefined];

describe('paths', () => {
  bench('logicalPath over request paths', () => {
    for (const path of REQUEST_PATHS) {
      logicalPath(path);
    }
  });

  bench('normalizeBase over base paths', () => {
    for (const base of BASES) {
      normalizeBase(base);
    }
  });

  bench('joinBase with mixed parts', () => {
    for (const base of BASES) {
      joinBase(base, ['/peerjs/', null, 'id'], '', undefined, 42);
    }
  });

  bench('route paths (socket, id, peers)', () => {
    for (const base of BASES) {
      socketPath(base);
      idPath(base, 'peerjs');
      peersPath(base, 'peerjs');
    }
  });
});
