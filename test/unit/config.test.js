import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { configFromEnv, redisUrlFromEnv } from '../../src/config.js';

describe('configFromEnv', () => {
  test('uses PeerJS defaults when the environment is empty', () => {
    const config = configFromEnv({});
    assert.equal(config.key, 'peerjs');
    assert.equal(config.path, '/');
    assert.equal(config.aliveTimeout, 90_000);
    assert.equal(config.expireTimeout, 5_000);
    assert.equal(config.cleanupIntervalMs, 10_000);
    assert.equal(config.presenceTouchMs, 30_000);
    assert.equal(config.relayPollMs, 1_000);
    assert.equal(config.aliveCheckIntervalMs, 5_000);
    assert.equal(config.concurrentLimit, 5_000);
    assert.equal(config.allowDiscovery, false);
    assert.equal(config.redisUrl, '');
    assert.equal(config.maxMessageBytes, 65_536);
  });

  test('reads explicit values', () => {
    const config = configFromEnv({
      PEERJS_KEY: 'secret',
      PEERJS_PATH: '/app',
      PEERJS_ALIVE_TIMEOUT: '1500',
      PEERJS_EXPIRE_TIMEOUT: '250',
      PEERJS_CLEANUP_INTERVAL: '40',
      PEERJS_ALIVE_CHECK_INTERVAL: '80',
      PEERJS_CONCURRENT_LIMIT: '3',
      ALLOW_DISCOVERY: 'true',
      REDIS_URL: 'redis://127.0.0.1:6379',
      PEERJS_MAX_MESSAGE_BYTES: '128'
    });

    assert.equal(config.key, 'secret');
    assert.equal(config.path, '/app');
    assert.equal(config.aliveTimeout, 1500);
    assert.equal(config.expireTimeout, 250);
    assert.equal(config.cleanupIntervalMs, 40);
    assert.equal(config.aliveCheckIntervalMs, 80);
    assert.equal(config.concurrentLimit, 3);
    assert.equal(config.allowDiscovery, true);
    assert.equal(config.redisUrl, 'redis://127.0.0.1:6379');
    assert.equal(config.maxMessageBytes, 128);
  });

  test('rejects non-positive and non-numeric limits', () => {
    const config = configFromEnv({
      PEERJS_ALIVE_TIMEOUT: '0',
      PEERJS_EXPIRE_TIMEOUT: '-5',
      PEERJS_CONCURRENT_LIMIT: 'nope',
      PEERJS_MAX_MESSAGE_BYTES: 'Infinity',
      ALLOW_DISCOVERY: 'yes',
      PEERJS_KEY: ''
    });

    assert.equal(config.aliveTimeout, 90_000);
    assert.equal(config.expireTimeout, 5_000);
    assert.equal(config.concurrentLimit, 5_000);
    assert.equal(config.maxMessageBytes, 65_536);
    assert.equal(config.allowDiscovery, false);
    assert.equal(config.key, 'peerjs');
  });

  test('uses the Hobby peer cap and the free Upstash database', () => {
    const config = configFromEnv({ VERCEL: '1' });
    assert.equal(config.concurrentLimit, 200);

    const capped = configFromEnv({
      VERCEL: '1',
      PEERJS_CONCURRENT_LIMIT: '40'
    });
    assert.equal(capped.concurrentLimit, 40);

    const url = redisUrlFromEnv({
      UPSTASH_REDIS_REST_URL: 'https://us1-example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'p/ass='
    });
    assert.equal(url, 'rediss://default:p%2Fass%3D@us1-example.upstash.io:6379');

    const explicit = redisUrlFromEnv({
      REDIS_URL: 'rediss://explicit.example:6379',
      UPSTASH_REDIS_REST_URL: 'https://us1-example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token'
    });
    assert.equal(explicit, 'rediss://explicit.example:6379');
  });
});
