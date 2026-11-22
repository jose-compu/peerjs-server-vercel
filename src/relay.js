const CHANNEL = 'psv:relay';
const LIVE_KEY = 'psv:live';
const LEGACY_INSTANCES_KEY = 'psv:instances';
const INBOX_READ = 100;

export function createMemoryRelay() {
  const listeners = new Set();

  return {
    async start() {},
    async publish(event) {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      listeners.clear();
    }
  };
}

export class InboxRelay {
  constructor(redis, instanceId, {
    pollMs = 1000,
    idlePollMs = 5000,
    burstMs = 20_000,
    presenceTtlMs = 90_000,
    presenceRefreshMs = 60_000,
    hasWork = () => true
  } = {}) {
    this.redis = redis;
    this.instanceId = instanceId;
    this.pollMs = pollMs;
    this.idlePollMs = Math.max(idlePollMs, pollMs);
    this.burstMs = burstMs;
    this.presenceTtlMs = presenceTtlMs;
    this.presenceRefreshMs = presenceRefreshMs;
    this.hasWork = hasWork;
    this.listener = null;
    this.timer = null;
    this.closed = false;
    this.started = false;
    this.released = true;
    this.migrated = false;
    this.lastPresence = 0;
    this.activeUntil = 0;
    this.liveCache = null;
    this.scheduledAt = 0;
  }

  inboxKey() {
    return `psv:inbox:${this.instanceId}`;
  }

  async start() {
    await this.ensureStarted();
  }

  async ensureStarted() {
    if (this.closed) {
      return;
    }
    if (!this.migrated) {
      await this.redis.del(LEGACY_INSTANCES_KEY);
      this.migrated = true;
    }
    if (this.started && !this.released) {
      return;
    }

    const now = Date.now();
    await this.redis.zadd(LIVE_KEY, now + this.presenceTtlMs, this.instanceId);
    this.started = true;
    this.released = false;
    this.lastPresence = now;
    this.liveCache = null;
  }

  isPolling() {
    return this.timer !== null;
  }

  suspend() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.release();
  }

  release() {
    if (!this.started || this.released) {
      return;
    }
    this.released = true;
    this.liveCache = null;
    this.redis.zrem(LIVE_KEY, this.instanceId).catch(() => {
      console.error('Failed to drop instance presence');
    });
  }

  wake({ burst = true } = {}) {
    if (this.closed || !this.hasWork()) {
      this.suspend();
      return;
    }
    if (burst) {
      this.activeUntil = Date.now() + this.burstMs;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.arm(0);
  }

  arm(delay) {
    if (this.closed || !this.hasWork()) {
      this.suspend();
      return;
    }

    this.scheduledAt = Date.now() + delay;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.poll()
        .catch(() => {
          console.error('Inbox relay poll failed');
        })
        .finally(() => {
          if (this.closed || !this.hasWork()) {
            this.suspend();
            return;
          }
          const wait = Date.now() < this.activeUntil ? this.pollMs : this.idlePollMs;
          this.arm(wait);
        });
    }, delay);
    this.timer.unref?.();
  }

  async liveIds(now) {
    if (this.liveCache && now - this.liveCache.at < 2000) {
      return this.liveCache.ids;
    }

    await this.redis.zremrangebyscore(LIVE_KEY, '-inf', now);
    const ids = await this.redis.zrange(LIVE_KEY, 0, -1);
    this.liveCache = { at: now, ids };
    return ids;
  }

  async publish(event) {
    await this.ensureStarted();
    const now = Date.now();
    const ids = await this.liveIds(now);
    const payload = JSON.stringify(event);
    const ttl = String(Math.max(this.idlePollMs * 3, 30_000));

    for (const id of ids) {
      if (id === this.instanceId) {
        continue;
      }
      const key = `psv:inbox:${id}`;
      await this.redis.rpush(key, payload);
      await this.redis.pexpire(key, ttl);
    }

    this.activeUntil = now + this.burstMs;
    if (!this.hasWork() || this.closed) {
      return;
    }
    const soon = now + this.pollMs;
    if (!this.timer || this.scheduledAt > soon) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.arm(this.pollMs);
    }
  }

  async poll() {
    if (this.closed || !this.listener || !this.hasWork()) {
      return;
    }

    const now = Date.now();
    if (now - this.lastPresence >= this.presenceRefreshMs) {
      this.lastPresence = now;
      await this.redis.zadd(LIVE_KEY, now + this.presenceTtlMs, this.instanceId);
      await this.redis.zremrangebyscore(LIVE_KEY, '-inf', now);
      this.liveCache = null;
    }

    const popped = await this.redis.lpop(this.inboxKey(), INBOX_READ);
    const items = Array.isArray(popped) ? popped : popped ? [popped] : [];
    if (items.length === 0) {
      return;
    }

    this.activeUntil = Date.now() + this.burstMs;
    for (const raw of items) {
      try {
        this.listener(JSON.parse(raw));
      } catch (error) {
        console.error('Ignored invalid inbox payload');
      }
    }
  }

  subscribe(listener) {
    this.listener = listener;
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  async close() {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.listener = null;
    if (!this.started) {
      return;
    }
    this.released = true;
    await this.redis.zrem(LIVE_KEY, this.instanceId);
    await this.redis.del(this.inboxKey());
  }
}

export class RedisRelay {
  constructor(publisher, subscriber, instanceId) {
    this.publisher = publisher;
    this.subscriber = subscriber;
    this.instanceId = instanceId;
    this.listener = null;
  }

  async start() {
    this.subscriber.on('message', (_channel, payload) => {
      if (!this.listener) {
        return;
      }

      try {
        this.listener(JSON.parse(payload));
      } catch (error) {
        console.error('Ignored invalid relay payload');
      }
    });

    await this.subscriber.subscribe(CHANNEL);
  }

  async publish(event) {
    await this.publisher.publish(CHANNEL, JSON.stringify(event));
  }

  subscribe(listener) {
    this.listener = listener;
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  async close() {
    this.listener = null;
    await this.subscriber.unsubscribe(CHANNEL);
    this.subscriber.disconnect();
    this.publisher.disconnect();
  }
}
