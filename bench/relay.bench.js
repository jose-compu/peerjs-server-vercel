import { EventEmitter } from 'node:events';
import { bench, describe } from 'vitest';
import { createMemoryRelay, InboxRelay, RedisRelay } from '../src/relay.js';
import { MiniRedis } from '../support/mini-redis.js';

const SIGNAL = {
  kind: 'signal',
  origin: 'instance-a',
  message: {
    type: 'CANDIDATE',
    src: 'alice',
    dst: 'bob',
    payload: {
      candidate: {
        candidate: 'candidate:842163049 1 udp 1677729535 203.0.113.7 54321 typ srflx raddr 0.0.0.0 rport 0',
        sdpMid: '0',
        sdpMLineIndex: 0
      },
      type: 'data',
      connectionId: 'dc_alice_bob'
    }
  }
};

const SIGNAL_PAYLOAD = JSON.stringify(SIGNAL);

class FakeSubscriber extends EventEmitter {
  async subscribe() {}
  async unsubscribe() {}
  disconnect() {}
}

describe('relay', () => {
  bench('memory relay publish to 50 listeners x 100 events', async () => {
    const relay = createMemoryRelay();
    let delivered = 0;
    for (let index = 0; index < 50; index += 1) {
      relay.subscribe(() => {
        delivered += 1;
      });
    }
    for (let index = 0; index < 100; index += 1) {
      await relay.publish(SIGNAL);
    }
    await relay.close();
    return delivered;
  });

  bench('RedisRelay dispatch 500 incoming payloads', async () => {
    const subscriber = new FakeSubscriber();
    const relay = new RedisRelay({ publish: async () => 1, disconnect() {} }, subscriber, 'instance-b');
    let delivered = 0;
    relay.subscribe(() => {
      delivered += 1;
    });
    await relay.start();
    for (let index = 0; index < 500; index += 1) {
      subscriber.emit('message', 'psv:relay', SIGNAL_PAYLOAD);
    }
    return delivered;
  });

  bench('InboxRelay publish to 20 instances and poll', async () => {
    const redis = new MiniRedis();
    const instances = Array.from(
      { length: 20 },
      (_, index) => new InboxRelay(redis, `instance-${index}`, { pollMs: 60_000 })
    );
    let delivered = 0;
    for (const instance of instances) {
      instance.subscribe(() => {
        delivered += 1;
      });
      await instance.start();
    }
    for (let index = 0; index < 10; index += 1) {
      await instances[0].publish(SIGNAL);
    }
    for (const instance of instances) {
      await instance.poll();
    }
    for (const instance of instances) {
      await instance.close();
    }
    return delivered;
  });
});
