import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { idPath, logicalPath, peersPath, socketPath } from '../src/paths.js';

describe('paths', () => {
  test('matches the PeerJS client url shape', () => {
    assert.equal(socketPath('/'), '/peerjs');
    assert.equal(idPath('/', 'peerjs'), '/peerjs/id');
    assert.equal(peersPath('/', 'peerjs'), '/peerjs/peers');
  });

  test('mounts a custom base path', () => {
    assert.equal(socketPath('/app'), '/app/peerjs');
    assert.equal(idPath('/app/', 'mykey'), '/app/mykey/id');
  });

  test('strips the Vercel function prefix', () => {
    assert.equal(logicalPath('/api/server/peerjs'), '/peerjs');
    assert.equal(logicalPath('/api/server/api/server/peerjs/id'), '/peerjs/id');
    assert.equal(logicalPath('/api/server'), '/');
    assert.equal(logicalPath('/peerjs/'), '/peerjs');
  });
});
