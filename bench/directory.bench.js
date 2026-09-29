import { bench, describe } from 'vitest';
import { MemoryDirectory, RedisDirectory } from '../src/directory.js';
import { MiniRedis } from '../support/mini-redis.js';

const PEERS = Array.from({ length: 200 }, (_, index) => `peer-${index}`);

function offer(src, dst) {
  return {
    type: 'OFFER',
    src,
    dst,
    payload: {
      sdp: { type: 'offer', sdp: 'v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n' },
      type: 'media',
      connectionId: `mc_${src}_${dst}`
    }
  };
}

function redisDirectory() {
  return new RedisDirectory(new MiniRedis(), { aliveTimeout: 90_000, expireTimeout: 5_000 });
}

async function lifecycle(directory) {
  for (const id of PEERS) {
    await directory.claim(id, `token-${id}`, 1_000, 90_000);
  }
  for (const id of PEERS) {
    await directory.touch(id, 1, 2_000, 90_000);
  }
  await directory.count();
  for (const id of PEERS) {
    await directory.removeIfGeneration(id, 1);
  }
}

async function queueRoundTrip(directory) {
  for (let index = 0; index < PEERS.length; index += 1) {
    const dst = PEERS[index];
    const src = PEERS[(index + 1) % PEERS.length];
    await directory.enqueue(dst, offer(src, dst), 100);
    await directory.enqueue(dst, { type: 'CANDIDATE', src, dst, payload: { candidate: 'c' } }, 110);
  }
  for (const id of PEERS) {
    await directory.drain(id);
  }
}

async function expireSweep(directory) {
  for (let index = 0; index < PEERS.length; index += 1) {
    const dst = PEERS[index];
    // Half of the queues are stale, half are fresh.
    const at = index % 2 === 0 ? 0 : 10_000;
    await directory.enqueue(dst, offer('sender', dst), at);
  }
  await directory.collectExpired(10_500, 5_000);
  for (const id of PEERS) {
    await directory.drain(id);
  }
}

describe('MemoryDirectory', () => {
  bench('claim/touch/remove 200 peers', async () => {
    await lifecycle(new MemoryDirectory());
  });

  bench('enqueue/drain 200 queues', async () => {
    await queueRoundTrip(new MemoryDirectory());
  });

  bench('collectExpired over 200 queues', async () => {
    await expireSweep(new MemoryDirectory());
  });
});

describe('RedisDirectory (in-memory redis)', () => {
  bench('claim/touch/remove 200 peers', async () => {
    await lifecycle(redisDirectory());
  });

  bench('enqueue/drain 200 queues', async () => {
    await queueRoundTrip(redisDirectory());
  });

  bench('collectExpired over 200 queues', async () => {
    await expireSweep(redisDirectory());
  });

  bench('ids with 200 registered peers', async () => {
    const directory = redisDirectory();
    for (const id of PEERS) {
      await directory.claim(id, `token-${id}`, 1_000, 90_000);
    }
    await directory.ids();
  });
});
