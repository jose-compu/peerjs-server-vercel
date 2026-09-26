const CLIENT_PREFIX = 'psv:client:';
const CLIENTS_KEY = 'psv:clients';
const QUEUE_PREFIX = 'psv:queue:';
const QUEUES_KEY = 'psv:queues';
const SWEEPER_KEY = 'psv:sweeper';

const CLAIM_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local generation = 1
if raw then
  local obj = cjson.decode(raw)
  if obj.token ~= ARGV[1] then
    return 0
  end
  generation = tonumber(obj.generation) + 1
end
local record = cjson.encode({
  token = ARGV[1],
  generation = generation,
  lastPing = tonumber(ARGV[2])
})
redis.call('SET', KEYS[1], record, 'PX', ARGV[3])
redis.call('SADD', KEYS[2], ARGV[4])
return generation
`;

const TOUCH_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local obj = cjson.decode(raw)
if tonumber(obj.generation) ~= tonumber(ARGV[1]) then
  return 0
end
obj.lastPing = tonumber(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode(obj), 'PX', ARGV[3])
return 1
`;

const REMOVE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return 0
end
local obj = cjson.decode(raw)
if tonumber(obj.generation) ~= tonumber(ARGV[1]) then
  return 0
end
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[2])
return 1
`;

export class MemoryDirectory {
  constructor() {
    this.clients = new Map();
    this.queues = new Map();
  }

  async claim(id, token, now = Date.now(), _ttlMs) {
    const existing = this.clients.get(id);
    if (existing && existing.token !== token) {
      return { ok: false };
    }

    const generation = (existing?.generation ?? 0) + 1;
    this.clients.set(id, { token, generation, lastPing: now });
    return { ok: true, generation };
  }

  async get(id) {
    return this.clients.get(id) ?? null;
  }

  async touch(id, generation, now = Date.now(), _ttlMs) {
    const existing = this.clients.get(id);
    if (!existing || existing.generation !== generation) {
      return false;
    }

    existing.lastPing = now;
    return true;
  }

  async removeIfGeneration(id, generation) {
    const existing = this.clients.get(id);
    if (!existing || existing.generation !== generation) {
      return false;
    }

    this.clients.delete(id);
    return true;
  }

  async has(id) {
    return this.clients.has(id);
  }

  async count() {
    return this.clients.size;
  }

  async ids() {
    return [...this.clients.keys()];
  }

  async enqueue(id, message, now = Date.now()) {
    const queue = this.queues.get(id) ?? [];
    queue.push({ at: now, message });
    this.queues.set(id, queue);
  }

  async drain(id) {
    const queue = this.queues.get(id) ?? [];
    this.queues.delete(id);
    return queue.map((item) => item.message);
  }

  async collectExpired(now, maxAge) {
    const expired = [];

    for (const [id, queue] of this.queues) {
      if (queue.length === 0) {
        this.queues.delete(id);
        continue;
      }

      if (now - queue[0].at < maxAge) {
        continue;
      }

      expired.push(...queue.map((item) => item.message));
      this.queues.delete(id);
    }

    return expired;
  }
}

export class RedisDirectory {
  constructor(redis, { aliveTimeout, expireTimeout }) {
    this.redis = redis;
    this.aliveTimeout = aliveTimeout;
    this.expireTimeout = expireTimeout;
  }

  clientKey(id) {
    return `${CLIENT_PREFIX}${id}`;
  }

  queueKey(id) {
    return `${QUEUE_PREFIX}${id}`;
  }

  async claim(id, token, now = Date.now(), ttlMs = this.aliveTimeout) {
    const generation = await this.redis.eval(
      CLAIM_SCRIPT,
      2,
      this.clientKey(id),
      CLIENTS_KEY,
      token,
      String(now),
      String(ttlMs),
      id
    );

    const value = Number(generation);
    if (!value) {
      return { ok: false };
    }

    return { ok: true, generation: value };
  }

  async get(id) {
    const raw = await this.redis.get(this.clientKey(id));
    if (!raw) {
      await this.redis.srem(CLIENTS_KEY, id);
      return null;
    }

    return JSON.parse(raw);
  }

  async touch(id, generation, now = Date.now(), ttlMs = this.aliveTimeout) {
    const updated = await this.redis.eval(
      TOUCH_SCRIPT,
      1,
      this.clientKey(id),
      String(generation),
      String(now),
      String(ttlMs)
    );
    return Number(updated) === 1;
  }

  async removeIfGeneration(id, generation) {
    const removed = await this.redis.eval(
      REMOVE_SCRIPT,
      2,
      this.clientKey(id),
      CLIENTS_KEY,
      String(generation),
      id
    );
    return Number(removed) === 1;
  }

  async has(id) {
    const exists = await this.redis.exists(this.clientKey(id));
    if (!exists) {
      await this.redis.srem(CLIENTS_KEY, id);
    }
    return exists === 1;
  }

  async count() {
    const ids = await this.ids();
    return ids.length;
  }

  async ids() {
    const ids = await this.redis.smembers(CLIENTS_KEY);
    const present = [];

    for (const id of ids) {
      if (await this.redis.exists(this.clientKey(id))) {
        present.push(id);
      } else {
        await this.redis.srem(CLIENTS_KEY, id);
      }
    }

    return present;
  }

  async enqueue(id, message, now = Date.now()) {
    const key = this.queueKey(id);
    await this.redis.rpush(key, JSON.stringify({ at: now, message }));
    await this.redis.pexpire(key, Math.max(this.expireTimeout * 2, this.expireTimeout + 1000));
    await this.redis.sadd(QUEUES_KEY, id);
  }

  async drain(id) {
    const key = this.queueKey(id);
    const rawItems = await this.redis.lrange(key, 0, -1);
    await this.redis.del(key);
    await this.redis.srem(QUEUES_KEY, id);
    return rawItems.map((raw) => JSON.parse(raw).message);
  }

  async collectExpired(now, maxAge) {
    const queued = await this.redis.scard(QUEUES_KEY);
    if (!queued) {
      return [];
    }

    const locked = await this.redis.set(SWEEPER_KEY, '1', 'PX', 800, 'NX');
    if (locked !== 'OK') {
      return [];
    }

    const ids = await this.redis.smembers(QUEUES_KEY);
    const expired = [];

    for (const id of ids) {
      const key = this.queueKey(id);
      const first = await this.redis.lindex(key, 0);
      if (!first) {
        await this.redis.srem(QUEUES_KEY, id);
        continue;
      }

      const head = JSON.parse(first);
      if (now - head.at < maxAge) {
        continue;
      }

      const rawItems = await this.redis.lrange(key, 0, -1);
      await this.redis.del(key);
      await this.redis.srem(QUEUES_KEY, id);
      expired.push(...rawItems.map((raw) => JSON.parse(raw).message));
    }

    return expired;
  }
}
