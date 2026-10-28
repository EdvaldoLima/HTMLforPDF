import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

vi.mock('../src/services/pdfService.js', () => ({ default: { generatePdfFromUrl: vi.fn() } }));

vi.mock('../src/services/queueService.js', () => ({
  default: { publishJob: vi.fn() },
  assertTopology: vi.fn(),
}));

vi.mock('../src/security/network.js', () => ({ resolvePublicUrl: vi.fn().mockResolvedValue({}) }));

import app from '../src/app.js';
import { config } from '../src/config/env.js';
import pdfService from '../src/services/pdfService.js';
import queueService from '../src/services/queueService.js';

let server: Server;
let base: string;
const originalKey = config.apiKey;

beforeAll(async () => {
  config.apiKey = 'options-validation-test-key-with-32-characters';
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

beforeEach(() => vi.clearAllMocks());

afterAll(async () => {
  config.apiKey = originalKey;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it.each([
  { pageRanges: '2-1' },
  { margin: { top: '100cm' } },
  { landscape: 'false' },
  { path: '/tmp/file.pdf' },
  { width: null },
])('returns 422 before rendering or enqueueing for invalid options %#', async (options) => {
  for (const path of ['/api/pdfs', '/api/pdfs/jobs']) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': config.apiKey },
      body: JSON.stringify({
        url: 'https://example.com',
        webhookUrl: 'https://example.org',
        options,
      }),
    });

    expect(response.status).toBe(422);
    expect((await response.json()).errors).toBeInstanceOf(Array);
    expect(pdfService.generatePdfFromUrl).not.toHaveBeenCalled();
    expect(queueService.publishJob).not.toHaveBeenCalled();
  }
});

it('accepts valid options immediately after rejecting invalid ones', async () => {
  vi.mocked(pdfService.generatePdfFromUrl).mockResolvedValue(Buffer.from('%PDF-test'));

  for (const [options, status] of [
    [{ pageRanges: '2-1' }, 422],
    [{ pageRanges: '1', scale: 1 }, 200],
  ] as const) {
    const response = await fetch(`${base}/api/pdfs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': config.apiKey },
      body: JSON.stringify({ url: 'https://example.com', options }),
    });

    expect(response.status).toBe(status);
    await response.arrayBuffer();
  }

  expect(pdfService.generatePdfFromUrl).toHaveBeenCalledOnce();
});
