import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Hobby rewrite targets the function file and keeps the public path', async () => {
  const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const rewrite = config.rewrites.find((entry) => entry.source === '/(.*)');
  assert.equal(rewrite.destination, '/api/server');
  assert.equal(config.functions['api/server.js'].maxDuration, 300);
});
