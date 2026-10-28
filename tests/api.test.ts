import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { config } from '../src/config/env.js';
import app from '../src/app.js';
let server: Server;
let base: string;
const original = config.apiKey;
beforeAll(async () => {
  config.apiKey = 'test-api-key-with-at-least-32-characters';
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  config.apiKey = original;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it('rejects unauthenticated requests', async () => {
  const response = await fetch(`${base}/api/pdfs`, { method: 'POST' });
  expect(response.status).toBe(401);
  expect(response.headers.get('x-request-id')).toBeTruthy();
  expect(response.headers.get('x-powered-by')).toBeNull();
});
it('rejects private source URLs', async () => {
  const response = await fetch(`${base}/api/pdfs`, {
    method: 'POST',
    headers: { 'X-API-Key': config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1' }),
  });
  expect(response.status).toBe(422);
});
it('rejects malformed JSON without returning internals', async () => {
  const response = await fetch(`${base}/api/pdfs`, {
    method: 'POST',
    headers: { 'X-API-Key': config.apiKey, 'Content-Type': 'application/json' },
    body: '{ secret',
  });
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain('secret');
});
it('provides liveness', async () => {
  expect((await fetch(`${base}/health/live`)).status).toBe(200);
});
