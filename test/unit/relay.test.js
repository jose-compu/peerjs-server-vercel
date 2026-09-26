import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createMemoryRelay } from '../../src/relay.js';

describe('memory relay', () => {
  test('delivers a published event to current subscribers', async () => {
    const relay = createMemoryRelay();
    const left = [];
    const right = [];
    relay.subscribe((event) => left.push(event));
    const unsubscribe = relay.subscribe((event) => right.push(event));

    await relay.publish({ kind: 'signal', origin: 'a' });
    unsubscribe();
    await relay.publish({ kind: 'signal', origin: 'b' });

    assert.deepEqual(left.map((event) => event.origin), ['a', 'b']);
    assert.deepEqual(right.map((event) => event.origin), ['a']);
  });

  test('close drops every subscriber', async () => {
    const relay = createMemoryRelay();
    const seen = [];
    relay.subscribe((event) => seen.push(event));
    await relay.close();
    await relay.publish({ kind: 'kick' });
    assert.deepEqual(seen, []);
  });
});
