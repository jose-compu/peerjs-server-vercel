import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RedisDirectory } from '../../src/directory.js';
import { MiniRedis } from '../../support/mini-redis.js';

function directory(redis = new MiniRedis()) {
  return new RedisDirectory(redis, { aliveTimeout: 90_000, expireTimeout: 5_000 });
}

describe('RedisDirectory', () => {
  test('claims, touches, and removes through the redis scripts', async () => {
    const redis = new MiniRedis();
    const peers = directory(redis);

    const first = await peers.claim('alice', 'token-a', 10);
    assert.deepEqual(first, { ok: true, generation: 1 });
    assert.equal(await peers.touch('alice', 1, 25), true);
    assert.equal((await peers.get('alice')).lastPing, 25);

    const again = await peers.claim('alice', 'token-a', 30);
    assert.equal(again.generation, 2);
    assert.deepEqual(await peers.claim('alice', 'token-b', 40), { ok: false });
    assert.equal((await peers.get('alice')).token, 'token-a');
    assert.equal(await peers.removeIfGeneration('alice', 1), false);
    assert.equal(await peers.has('alice'), true);
    assert.equal(await peers.removeIfGeneration('alice', 2), true);
    assert.equal(await peers.get('alice'), null);
    assert.equal(await peers.count(), 0);
  });

  test('drops a set member whose client key is already gone', async () => {
    const redis = new MiniRedis();
    const peers = directory(redis);
    await redis.sadd('psv:clients', 'ghost');
    assert.equal(await peers.get('ghost'), null);
    assert.deepEqual(await peers.ids(), []);
    assert.equal(await peers.count(), 0);
  });

  test('drains queued messages and expires them once', async () => {
    const peers = directory();
    await peers.enqueue('bob', { type: 'OFFER', src: 'alice', dst: 'bob' }, 1_000);
    await peers.enqueue('bob', { type: 'ANSWER', src: 'carol', dst: 'bob' }, 1_100);

    assert.deepEqual(await peers.collectExpired(1_200, 5_000), []);
    const drained = await peers.drain('bob');
    assert.deepEqual(drained.map((message) => message.type), ['OFFER', 'ANSWER']);
    assert.deepEqual(await peers.drain('bob'), []);
  });

  test('holds the sweeper lock until the current pass finishes', async () => {
    const peers = directory();
    await peers.enqueue('bob', { type: 'OFFER', src: 'alice', dst: 'bob' }, 1_000);

    assert.deepEqual(await peers.collectExpired(1_200, 5_000), []);
    assert.deepEqual(await peers.collectExpired(10_000, 1_000), []);
    assert.equal((await peers.drain('bob')).length, 1);
  });
});
