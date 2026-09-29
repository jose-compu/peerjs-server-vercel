import { bench, describe } from 'vitest';
import { configFromEnv, redisUrlFromEnv } from '../src/config.js';

const EMPTY_ENV = {};

const FULL_ENV = {
  VERCEL: '1',
  PEERJS_KEY: 'custom',
  PEERJS_PATH: '/signal',
  PEERJS_ALIVE_TIMEOUT: '60000',
  PEERJS_EXPIRE_TIMEOUT: '4000',
  PEERJS_CLEANUP_INTERVAL: '8000',
  PEERJS_ALIVE_CHECK_INTERVAL: 'not-a-number',
  PEERJS_CONCURRENT_LIMIT: '-1',
  ALLOW_DISCOVERY: 'true',
  PEERJS_RELAY_POLL_MS: '500',
  PEERJS_PRESENCE_TOUCH_MS: '15000',
  PEERJS_MAX_MESSAGE_BYTES: '32768',
  KV_REST_API_URL: 'https://example-123.upstash.io',
  KV_REST_API_TOKEN: 'token with spaces/and+symbols='
};

const EXPLICIT_URL_ENV = {
  REDIS_URL: '  ',
  UPSTASH_REDIS_URL: 'rediss://default:secret@example.upstash.io:6379'
};

const INVALID_REST_ENV = {
  UPSTASH_REDIS_REST_URL: 'not a url',
  UPSTASH_REDIS_REST_TOKEN: 'token'
};

describe('config', () => {
  bench('configFromEnv with defaults', () => {
    configFromEnv(EMPTY_ENV);
  });

  bench('configFromEnv with full Vercel env', () => {
    configFromEnv(FULL_ENV);
  });

  bench('redisUrlFromEnv variants', () => {
    redisUrlFromEnv(EMPTY_ENV);
    redisUrlFromEnv(EXPLICIT_URL_ENV);
    redisUrlFromEnv(FULL_ENV);
    redisUrlFromEnv(INVALID_REST_ENV);
  });
});
