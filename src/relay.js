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
