async function command(url, token, args, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error || `Upstash request failed (${response.status})`);
  }
  return body.result;
}

export function createUpstashClient(url, token, fetchImpl = globalThis.fetch) {
  const call = (...args) => command(url, token, args, fetchImpl);

  return {
    async get(key) {
      return call('GET', key);
    },

    async set(key, value, ...flags) {
      return call('SET', key, value, ...flags.map(String));
    },

    async eval(script, numKeys, ...args) {
      return call('EVAL', script, String(numKeys), ...args.map(String));
    },

    async exists(key) {
      return call('EXISTS', key);
    },

    async del(...keys) {
      return call('DEL', ...keys);
    },

    async sadd(key, ...members) {
      return call('SADD', key, ...members);
    },

    async srem(key, ...members) {
      return call('SREM', key, ...members);
    },

    async smembers(key) {
      return call('SMEMBERS', key);
    },

    async scard(key) {
      return call('SCARD', key);
    },

    async rpush(key, ...items) {
      return call('RPUSH', key, ...items);
    },

    async lrange(key, start, stop) {
      return call('LRANGE', key, String(start), String(stop));
    },

    async lpop(key, count) {
      return call('LPOP', key, String(count));
    },

    async llen(key) {
      return call('LLEN', key);
    },

    async zadd(key, score, member) {
      return call('ZADD', key, String(score), String(member));
    },

    async zrem(key, member) {
      return call('ZREM', key, String(member));
    },

    async zrange(key, start, stop) {
      return call('ZRANGE', key, String(start), String(stop));
    },

    async zremrangebyscore(key, min, max) {
      return call('ZREMRANGEBYSCORE', key, String(min), String(max));
    },

    async lindex(key, index) {
      return call('LINDEX', key, String(index));
    },

    async pexpire(key, ttl) {
      return call('PEXPIRE', key, String(ttl));
    }
  };
}
