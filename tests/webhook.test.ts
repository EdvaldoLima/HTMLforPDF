import { afterEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('undici', async (importOriginal) => {
  const original = await importOriginal<typeof import('undici')>();

  return { ...original, fetch: vi.fn() };
});

import { fetch } from 'undici';
import webhookService from '../src/services/webhookService.js';

afterEach(() => {
  vi.resetAllMocks();
  delete process.env.WEBHOOK_SECRET;
});

it('signs the PDF, disables redirects, and cancels the response body', async () => {
  process.env.WEBHOOK_SECRET = 'webhook-test-secret';

  const cancel = vi.fn();

  vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, body: { cancel } } as never);

  const pdf = Buffer.from('pdf');

  expect(await webhookService.sendPdfToWebhook(pdf, 'https://example.com', 'job-123')).toBe(true);

  const options = vi.mocked(fetch).mock.calls[0][1]!;

  expect(options.redirect).toBe('error');
  expect(options.signal).toBeDefined();

  const headers = options.headers as Record<string, string>;

  expect(headers['Idempotency-Key']).toBe('job-123');

  expect(headers['X-Webhook-Signature']).toBe(
    createHmac('sha256', process.env.WEBHOOK_SECRET)
      .update(`${headers['X-Webhook-Timestamp']}.job-123.`)
      .update(pdf)
      .digest('hex'),
  );

  expect(cancel).toHaveBeenCalledOnce();
});

it('returns false on webhook rejection', async () => {
  vi.mocked(fetch).mockResolvedValue({
    ok: false,
    status: 500,
    body: { cancel: vi.fn() },
  } as never);

  expect(
    await webhookService.sendPdfToWebhook(Buffer.from('pdf'), 'https://example.com', 'job'),
  ).toBe(false);
});

it('never fetches a private destination', async () => {
  expect(await webhookService.sendPdfToWebhook(Buffer.from('pdf'), 'http://127.0.0.1', 'job')).toBe(
    false,
  );

  expect(fetch).not.toHaveBeenCalled();
});
