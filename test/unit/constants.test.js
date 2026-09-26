import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ID_PATTERN, MessageType, RELAY_TYPES } from '../../src/constants.js';

describe('protocol constants', () => {
  test('relays only signaling frames', () => {
    assert.equal(RELAY_TYPES.has(MessageType.OFFER), true);
    assert.equal(RELAY_TYPES.has(MessageType.ANSWER), true);
    assert.equal(RELAY_TYPES.has(MessageType.CANDIDATE), true);
    assert.equal(RELAY_TYPES.has(MessageType.LEAVE), true);
    assert.equal(RELAY_TYPES.has(MessageType.EXPIRE), true);
    assert.equal(RELAY_TYPES.has(MessageType.HEARTBEAT), false);
    assert.equal(RELAY_TYPES.has(MessageType.OPEN), false);
    assert.equal(RELAY_TYPES.has(MessageType.ID_TAKEN), false);
  });

  test('accepts dignity and uuid peer ids', () => {
    assert.equal(ID_PATTERN.test('dignityjs_ab12'), true);
    assert.equal(ID_PATTERN.test('550e8400-e29b-41d4-a716-446655440000'), true);
    assert.equal(ID_PATTERN.test(''), false);
    assert.equal(ID_PATTERN.test('bad id'), false);
    assert.equal(ID_PATTERN.test('a'.repeat(65)), false);
  });
});
