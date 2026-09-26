import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { InboxRelay } from '../../src/relay.js';
import { MiniRedis } from '../../support/mini-redis.js';

describe('inbox relay', () => {
  test('delivers a signal to the other free-tier instance', async () => {
    const redis = new MiniRedis();
    const left = new InboxRelay(redis, 'left', { pollMs: 60_000, hasWork: () => true });
    const right = new InboxRelay(redis, 'right', { pollMs: 60_000, hasWork: () => true });
    const seen = [];
    right.subscribe((event) => seen.push(event));

    try {
      await left.start();
      await right.start();
      await left.publish({
        kind: 'signal',
        origin: 'left',
        message: { type: 'OFFER', dst: 'bob' }
      });
      await right.poll();
      assert.equal(seen.length, 1);
      assert.equal(seen[0].message.type, 'OFFER');
      assert.equal(seen[0].message.dst, 'bob');
    } finally {
      await left.close();
      await right.close();
    }
  });

  test('does not poll while the instance has no peers', async () => {
    const redis = new MiniRedis();
    let polls = 0;
    const original = redis.eval.bind(redis);
    redis.eval = async (...args) => {
      polls += 1;
      return original(...args);
    };
    const relay = new InboxRelay(redis, 'solo', { pollMs: 60_000, hasWork: () => false });
    relay.subscribe(() => {});

    try {
      await relay.start();
      await relay.poll();
      assert.equal(polls, 0);
    } finally {
      await relay.close();
    }
  });
});
