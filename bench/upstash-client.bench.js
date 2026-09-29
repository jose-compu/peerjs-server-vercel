import { bench, describe } from 'vitest';
import { RedisDirectory } from '../src/directory.js';
import { createUpstashClient } from '../src/upstash-client.js';

// Answers every command locally so only request building and response
// handling in the client is measured, not the network.
async function fakeFetch(_url, init) {
  const [command] = JSON.parse(init.body);
  let result = 'OK';
  if (command === 'EVAL') {
    result = 1;
  } else if (command === 'GET') {
    result = JSON.stringify({ token: 'token', generation: 1, lastPing: 1 });
  } else if (command === 'EXISTS' || command === 'SADD' || command === 'RPUSH') {
    result = 1;
  }
  return {
    ok: true,
    json: async () => ({ result })
  };
}

const client = createUpstashClient('https://us1-example.upstash.io', 'secret-token', fakeFetch);
const directory = new RedisDirectory(client, { aliveTimeout: 90_000, expireTimeout: 5_000 });
const MESSAGE = {
  type: 'OFFER',
  src: 'alice',
  dst: 'bob',
  payload: { sdp: { type: 'offer', sdp: 'v=0\r\n' }, type: 'data', connectionId: 'dc_1' }
};

describe('Upstash REST client', () => {
  bench('100 SET/GET commands', async () => {
    for (let index = 0; index < 50; index += 1) {
      await client.set(`psv:instance:${index}`, '1', 'PX', 15_000, 'NX');
      await client.get(`psv:instance:${index}`);
    }
  });

  bench('RedisDirectory claim/enqueue over REST (50 peers)', async () => {
    for (let index = 0; index < 50; index += 1) {
      const id = `peer-${index}`;
      await directory.claim(id, 'token', 1_000);
      await directory.enqueue(id, MESSAGE, 1_000);
    }
  });
});
