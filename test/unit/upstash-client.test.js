import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createUpstashClient } from '../../src/upstash-client.js';

describe('Upstash REST client', () => {
  test('sends Redis commands as JSON arrays', async () => {
    const calls = [];
    const fetchImpl = async (_url, init) => {
      calls.push({
        authorization: init.headers.Authorization,
        body: JSON.parse(init.body)
      });
      return {
        ok: true,
        json: async () => ({ result: calls.length === 1 ? 'OK' : ['queued'] })
      };
    };

    const client = createUpstashClient('https://us1-example.upstash.io', 'secret', fetchImpl);
    assert.equal(await client.set('psv:instance:a', '1', 'PX', '15000', 'NX'), 'OK');
    assert.deepEqual(await client.eval('return 1', 1, 'psv:inbox:a'), ['queued']);

    assert.equal(calls[0].authorization, 'Bearer secret');
    assert.deepEqual(calls[0].body, ['SET', 'psv:instance:a', '1', 'PX', '15000', 'NX']);
    assert.deepEqual(calls[1].body, ['EVAL', 'return 1', '1', 'psv:inbox:a']);
  });

  test('surfaces an Upstash error', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ error: 'max requests limit exceeded' })
    });
    const client = createUpstashClient('https://us1-example.upstash.io', 'secret', fetchImpl);
    await assert.rejects(() => client.get('peer'), /max requests limit exceeded/);
  });
});