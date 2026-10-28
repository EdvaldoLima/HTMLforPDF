import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer, request, type Server } from 'node:http';

// The test destination is intentionally local. Production DNS policy is tested
// separately; only this mock lets the proxy connect to our fixture server.
vi.mock('../src/security/network.js', () => ({
  resolvePublicUrl: vi.fn(async (value: string) => ({
    url: new URL(value),
    address: '127.0.0.1',
    family: 4,
  })),
}));

import { createBrowserProxy } from '../src/security/browserProxy.js';
import { resolvePublicUrl } from '../src/security/network.js';
import { PublicError } from '../src/utils/errors.js';

let fixture: Server;
let target: string;

beforeAll(async () => {
  fixture = createServer((req, res) => {
    req.resume();
    res.end(req.url === '/large' ? 'x'.repeat(2048) : 'ok');
  }).listen(0, '127.0.0.1');

  await new Promise<void>((resolve) => fixture.once('listening', resolve));
  target = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
});

function throughProxy(proxy: string, route = '/', body = '') {
  return new Promise<string>((resolve, reject) => {
    request(proxy, { path: target + route, method: body ? 'POST' : 'GET' }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk.toString();
      });

      res.on('error', reject);
      res.on('end', () => resolve(data));
    })
      .on('error', reject)
      .end(body);
  });
}

it('forwards a valid request to the pinned IP', async () => {
  const proxy = await createBrowserProxy(10_000);

  try {
    await expect(throughProxy(proxy.url)).resolves.toBe('ok');
    expect(proxy.hasExceededBudget()).toBe(false);
  } finally {
    await proxy.close();
  }
});

it('stops additional requests after the per-render request limit', async () => {
  const proxy = await createBrowserProxy(10_000, 1);

  try {
    await throughProxy(proxy.url);
    await expect(throughProxy(proxy.url)).rejects.toThrow();
    expect(proxy.hasExceededBudget()).toBe(true);
  } finally {
    await proxy.close();
  }
});

it.each(['download', 'upload'])('counts %s bytes against the network budget', async (direction) => {
  const proxy = await createBrowserProxy(500);

  try {
    await expect(
      throughProxy(
        proxy.url,
        direction === 'download' ? '/large' : '/',
        direction === 'upload' ? 'x'.repeat(2048) : '',
      ),
    ).rejects.toThrow();

    expect(proxy.hasExceededBudget()).toBe(true);
  } finally {
    await proxy.close();
  }
});

it('preserves temporary DNS failures as a retryable HTTP response', async () => {
  vi.mocked(resolvePublicUrl).mockRejectedValueOnce(
    new PublicError(503, 'DNS temporarily unavailable'),
  );

  const proxy = await createBrowserProxy(10_000);

  try {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      request(proxy.url, { path: target }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
        .on('error', reject)
        .end();
    });

    expect(status).toBe(503);
  } finally {
    await proxy.close();
  }
});
