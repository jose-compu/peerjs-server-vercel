function positiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function firstValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

// The Marketplace sets REDIS_URL or KV_URL, plus a REST URL and token.
// A long-lived Node process uses TCP. Vercel uses REST so the 2 GB Fluid
// instance can pause when no peer socket is open.
export function redisUrlFromEnv(env = process.env) {
  const explicit = firstValue(env.REDIS_URL, env.UPSTASH_REDIS_URL, env.KV_URL);
  if (explicit) {
    return explicit;
  }

  const restUrl = firstValue(env.UPSTASH_REDIS_REST_URL, env.KV_REST_API_URL);
  const token = firstValue(env.UPSTASH_REDIS_REST_TOKEN, env.KV_REST_API_TOKEN);
  if (!restUrl || !token) {
    return '';
  }

  try {
    const host = new URL(restUrl).hostname;
    if (!host) {
      return '';
    }
    return `rediss://default:${encodeURIComponent(token)}@${host}:6379`;
  } catch (error) {
    return '';
  }
}

export function relayModeFromEnv(env, { redisUrl = '', upstashRestUrl = '', upstashRestToken = '' } = {}) {
  const forced = env.PEERJS_RELAY_MODE;
  if (forced === 'rest' || forced === 'tcp' || forced === 'memory') {
    return forced;
  }

  const rest = Boolean(upstashRestUrl && upstashRestToken);
  if (env.VERCEL === '1' && rest) {
    return 'rest';
  }
  if (redisUrl) {
    return 'tcp';
  }
  if (rest) {
    return 'rest';
  }
  return 'memory';
}

export function configFromEnv(env = process.env) {
  const onVercel = env.VERCEL === '1';
  const redisUrl = redisUrlFromEnv(env);
  const upstashRestUrl = firstValue(env.UPSTASH_REDIS_REST_URL, env.KV_REST_API_URL);
  const upstashRestToken = firstValue(env.UPSTASH_REDIS_REST_TOKEN, env.KV_REST_API_TOKEN);

  return {
    key: env.PEERJS_KEY || 'peerjs',
    path: env.PEERJS_PATH || '/',
    aliveTimeout: positiveNumber(env.PEERJS_ALIVE_TIMEOUT, 90_000),
    expireTimeout: positiveNumber(env.PEERJS_EXPIRE_TIMEOUT, 5_000),
    cleanupIntervalMs: positiveNumber(env.PEERJS_CLEANUP_INTERVAL, 10_000),
    aliveCheckIntervalMs: positiveNumber(env.PEERJS_ALIVE_CHECK_INTERVAL, 5_000),
    concurrentLimit: positiveNumber(env.PEERJS_CONCURRENT_LIMIT, onVercel ? 200 : 5_000),
    allowDiscovery: env.ALLOW_DISCOVERY === 'true',
    redisUrl,
    upstashRestUrl,
    upstashRestToken,
    relayMode: relayModeFromEnv(env, { redisUrl, upstashRestUrl, upstashRestToken }),
    relayPollMs: positiveNumber(env.PEERJS_RELAY_POLL_MS, 1_000),
    presenceTouchMs: positiveNumber(env.PEERJS_PRESENCE_TOUCH_MS, 30_000),
    maxMessageBytes: positiveNumber(env.PEERJS_MAX_MESSAGE_BYTES, 65_536)
  };
}
