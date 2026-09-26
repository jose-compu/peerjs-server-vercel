import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MemoryDirectory } from '../../src/directory.js';

describe('MemoryDirectory', () => {
  test('claims, refreshes, and removes by generation', async () => {
    const directory = new MemoryDirectory();
    const first = await directory.claim('alice', 'token-a', 10);
    assert.deepEqual(first, { ok: true, generation: 1 });
    assert.equal((await directory.get('alice')).token, 'token-a');
    assert.equal(await directory.touch('alice', 1, 20), true);
    assert.equal((await directory.get('alice')).lastPing, 20);
    assert.equal(await directory.touch('alice', 9, 30), false);

    const again = await directory.claim('alice', 'token-a', 40);
    assert.equal(again.generation, 2);
    assert.equal(await directory.removeIfGeneration('alice', 1), false);
    assert.equal(await directory.has('alice'), true);
    assert.equal(await directory.removeIfGeneration('alice', 2), true);
    assert.equal(await directory.get('alice'), null);
    assert.equal(await directory.count(), 0);
  });

  test('rejects a different token without replacing the record', async () => {
    const directory = new MemoryDirectory();
    await directory.claim('alice', 'token-a', 10);
    const stolen = await directory.claim('alice', 'token-b', 20);
    assert.deepEqual(stolen, { ok: false });
    assert.equal((await directory.get('alice')).generation, 1);
    assert.equal((await directory.get('alice')).token, 'token-a');
  });

  test('queues messages in order and expires only stale queues', async () => {
    const directory = new MemoryDirectory();
    await directory.enqueue('bob', { type: 'OFFER', src: 'alice', dst: 'bob' }, 100);
    await directory.enqueue('bob', { type: 'CANDIDATE', src: 'alice', dst: 'bob' }, 110);
    await directory.enqueue('carol', { type: 'OFFER', src: 'alice', dst: 'carol' }, 500);

    assert.deepEqual(await directory.collectExpired(150, 80), []);
    const drained = await directory.drain('bob');
    assert.deepEqual(drained.map((message) => message.type), ['OFFER', 'CANDIDATE']);
    assert.deepEqual(await directory.drain('bob'), []);

    const expired = await directory.collectExpired(600, 80);
    assert.equal(expired.length, 1);
    assert.equal(expired[0].dst, 'carol');
    assert.deepEqual(await directory.collectExpired(700, 80), []);
  });

  test('lists every registered id', async () => {
    const directory = new MemoryDirectory();
    await directory.claim('alice', 'a', 1);
    await directory.claim('bob', 'b', 1);
    assert.deepEqual((await directory.ids()).sort(), ['alice', 'bob']);
  });
});
