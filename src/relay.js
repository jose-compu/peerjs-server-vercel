const CHANNEL = 'psv:relay';

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

const DRAIN_INBOX = `
local items = redis.call('LRANGE', KEYS[1], 0, -1)
if #items > 0 then
  redis.call('DEL', KEYS[1])
end
return items
`;

export class InboxRelay {
  constructor(redis, instanceId, { pollMs = 1000, hasWork = () => true } = {}) {
    this.redis = redis;
    this.instanceId = instanceId;
    this.pollMs = pollMs;
    this.hasWork = hasWork;
    this.listener = null;
    this.timer = null;
    this.closed = false;
    this.lastPresence = 0;
  }

  presenceKey() {
    return `psv:instance:${this.instanceId}`;
  }

  inboxKey() {
    return `psv:inbox:${this.instanceId}`;
  }

  async start() {
    await this.redis.sadd('psv:instances', this.instanceId);
    await this.redis.set(this.presenceKey(), '1', 'PX', String(Math.max(this.pollMs * 20, 15_000)));
    this.timer = setInterval(() => {
      this.poll().catch(() => {
        console.error('Inbox relay poll failed');
      });
    }, this.pollMs);
    this.timer.unref?.();
  }

  async publish(event) {
    const instances = await this.redis.smembers('psv:instances');
    const payload = JSON.stringify(event);

    for (const id of instances) {
      if (id === this.instanceId) {
        continue;
      }

      const alive = await this.redis.exists(`psv:instance:${id}`);
      if (!alive) {
        await this.redis.srem('psv:instances', id);
        continue;
      }

      await this.redis.rpush(`psv:inbox:${id}`, payload);
    }
  }

  async poll() {
    if (this.closed || !this.listener || !this.hasWork()) {
      return;
    }

    const now = Date.now();
    if (now - this.lastPresence >= 10_000) {
      this.lastPresence = now;
      await this.redis.set(this.presenceKey(), '1', 'PX', String(Math.max(this.pollMs * 20, 15_000)));
    }
    const items = await this.redis.eval(DRAIN_INBOX, 1, this.inboxKey());
    if (!Array.isArray(items)) {
      return;
    }

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
      clearInterval(this.timer);
      this.timer = null;
    }
    this.listener = null;
    await this.redis.srem('psv:instances', this.instanceId);
    await this.redis.del(this.presenceKey());
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
