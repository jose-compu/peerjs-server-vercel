export class MiniRedis {
  constructor() {
    this.values = new Map();
    this.sets = new Map();
    this.lists = new Map();
  }

  #fresh(bucket, key) {
    const entry = bucket.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt && Date.now() >= entry.expiresAt) {
      bucket.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key) {
    return this.#fresh(this.values, key)?.value ?? null;
  }

  async set(key, value, ...flags) {
    const normalized = flags.map((flag) => String(flag).toUpperCase());
    const pxAt = normalized.indexOf('PX');
    const nx = normalized.includes('NX');
    if (nx && this.#fresh(this.values, key)) {
      return null;
    }

    const ttl = pxAt === -1 ? 0 : Number(flags[pxAt + 1]);
    this.values.set(key, {
      value: String(value),
      expiresAt: ttl ? Date.now() + ttl : 0
    });
    return 'OK';
  }

  async exists(key) {
    return this.#fresh(this.values, key) ? 1 : 0;
  }

  async del(...keys) {
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key) || this.lists.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  }

  async sadd(key, ...members) {
    const set = this.sets.get(key) ?? new Set();
    for (const member of members) {
      set.add(String(member));
    }
    this.sets.set(key, set);
    return members.length;
  }

  async srem(key, ...members) {
    const set = this.sets.get(key);
    if (!set) {
      return 0;
    }
    let removed = 0;
    for (const member of members) {
      if (set.delete(String(member))) {
        removed += 1;
      }
    }
    return removed;
  }

  async smembers(key) {
    return [...(this.sets.get(key) ?? new Set())];
  }

  async scard(key) {
    return (this.sets.get(key) ?? new Set()).size;
  }

  async rpush(key, ...items) {
    const entry = this.#fresh(this.lists, key) ?? { value: [], expiresAt: 0 };
    entry.value.push(...items.map(String));
    this.lists.set(key, entry);
    return entry.value.length;
  }

  async lrange(key, start, stop) {
    const entry = this.#fresh(this.lists, key);
    if (!entry) {
      return [];
    }
    const list = entry.value;
    const end = stop < 0 ? list.length + stop : stop;
    return list.slice(start, end + 1);
  }

  async lindex(key, index) {
    const entry = this.#fresh(this.lists, key);
    if (!entry) {
      return null;
    }
    return entry.value[index] ?? null;
  }

  async pexpire(key, ttl) {
    const entry = this.#fresh(this.lists, key) ?? this.#fresh(this.values, key);
    if (!entry) {
      return 0;
    }
    entry.expiresAt = Date.now() + Number(ttl);
    return 1;
  }

  async eval(script, numKeys, ...args) {
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys).map(String);

    if (script.includes('LRANGE')) {
      const items = await this.lrange(keys[0], 0, -1);
      if (items.length > 0) {
        await this.del(keys[0]);
      }
      return items;
    }
    if (script.includes('SADD')) {
      return this.#claim(keys, argv);
    }
    if (script.includes('SREM')) {
      return this.#remove(keys, argv);
    }
    if (script.includes('lastPing')) {
      return this.#touch(keys, argv);
    }

    throw new Error('Unknown Redis script');
  }

  async #claim(keys, argv) {
    const [clientKey, clientsKey] = keys;
    const [token, now, ttl, id] = argv;
    const raw = await this.get(clientKey);
    let generation = 1;

    if (raw) {
      const existing = JSON.parse(raw);
      if (existing.token !== token) {
        return 0;
      }
      generation = Number(existing.generation) + 1;
    }

    await this.set(
      clientKey,
      JSON.stringify({ token, generation, lastPing: Number(now) }),
      'PX',
      ttl
    );
    await this.sadd(clientsKey, id);
    return generation;
  }

  async #touch(keys, argv) {
    const [clientKey] = keys;
    const [generation, now, ttl] = argv;
    const raw = await this.get(clientKey);
    if (!raw) {
      return 0;
    }

    const existing = JSON.parse(raw);
    if (Number(existing.generation) !== Number(generation)) {
      return 0;
    }

    existing.lastPing = Number(now);
    await this.set(clientKey, JSON.stringify(existing), 'PX', ttl);
    return 1;
  }

  async #remove(keys, argv) {
    const [clientKey, clientsKey] = keys;
    const [generation, id] = argv;
    const raw = await this.get(clientKey);
    if (!raw) {
      return 0;
    }

    const existing = JSON.parse(raw);
    if (Number(existing.generation) !== Number(generation)) {
      return 0;
    }

    await this.del(clientKey);
    await this.srem(clientsKey, id);
    return 1;
  }
}
