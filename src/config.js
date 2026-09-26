function positiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function configFromEnv(env = process.env) {
  return {
    key: env.PEERJS_KEY || 'peerjs',
    path: env.PEERJS_PATH || '/',
    aliveTimeout: positiveNumber(env.PEERJS_ALIVE_TIMEOUT, 90_000),
    expireTimeout: positiveNumber(env.PEERJS_EXPIRE_TIMEOUT, 5_000),
    cleanupIntervalMs: positiveNumber(env.PEERJS_CLEANUP_INTERVAL, 1_000),
    aliveCheckIntervalMs: positiveNumber(env.PEERJS_ALIVE_CHECK_INTERVAL, 5_000),
    concurrentLimit: positiveNumber(env.PEERJS_CONCURRENT_LIMIT, 5_000),
    allowDiscovery: env.ALLOW_DISCOVERY === 'true',
    redisUrl: env.REDIS_URL || '',
    maxMessageBytes: positiveNumber(env.PEERJS_MAX_MESSAGE_BYTES, 65_536)
  };
}
