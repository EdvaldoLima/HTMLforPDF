import { beforeEach, expect, it, vi } from 'vitest';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

vi.mock('../src/services/pdfService.js', () => ({ default: { generatePdfFromUrl: vi.fn() } }));
vi.mock('../src/services/webhookService.js', () => ({ default: { sendPdfToWebhook: vi.fn() } }));
vi.mock('../src/services/queueService.js', () => ({ sendConfirmed: vi.fn() }));
import pdfService from '../src/services/pdfService.js';
import webhookService from '../src/services/webhookService.js';
import { sendConfirmed } from '../src/services/queueService.js';
import { processJob } from '../src/worker/processJob.js';
import { config } from '../src/config/env.js';

const job = {
  jobId: '72b038c4-d87f-4f63-9aa3-8bfb7353994e',
  url: 'https://example.com',
  webhookUrl: 'https://example.org',
};
const message = (body: unknown = job, headers = {}) =>
  ({ content: Buffer.from(JSON.stringify(body)), properties: { headers } } as ConsumeMessage);
let channel: ConfirmChannel;

beforeEach(() => {
  vi.resetAllMocks();
  channel = { ack: vi.fn(), nack: vi.fn() } as unknown as ConfirmChannel;
  vi.mocked(pdfService.generatePdfFromUrl).mockResolvedValue(Buffer.from('pdf'));
  vi.mocked(webhookService.sendPdfToWebhook).mockResolvedValue(true);
  vi.mocked(sendConfirmed).mockResolvedValue();
});

it('acknowledges successful delivery exactly once', async () => {
  await processJob(channel, message());
  expect(channel.ack).toHaveBeenCalledTimes(1);
  expect(channel.nack).not.toHaveBeenCalled();
  expect(sendConfirmed).not.toHaveBeenCalled();
});

it('confirms retry before acknowledging original on webhook failure', async () => {
  vi.mocked(webhookService.sendPdfToWebhook).mockResolvedValue(false);
  await processJob(channel, message());

  expect(sendConfirmed).toHaveBeenCalledWith(
    channel,
    `${config.queue}.retry`,
    expect.any(Buffer),
    expect.objectContaining({ headers: { 'x-attempt': 1 } }),
  );

  expect(vi.mocked(sendConfirmed).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(channel.ack).mock.invocationCallOrder[0],
  );

  expect(channel.nack).not.toHaveBeenCalled();
});

it('does not acknowledge if retry publication fails', async () => {
  vi.mocked(webhookService.sendPdfToWebhook).mockResolvedValue(false);
  vi.mocked(sendConfirmed).mockRejectedValue(new Error('broker unavailable'));
  await expect(processJob(channel, message())).rejects.toThrow();
  expect(channel.ack).not.toHaveBeenCalled();
  expect(channel.nack).not.toHaveBeenCalled();
});

it('dead-letters after exhausting attempts', async () => {
  vi.mocked(pdfService.generatePdfFromUrl).mockRejectedValue(new Error('timeout'));

  const msg = message(job, { 'x-attempt': config.maxAttempts - 1 });

  await processJob(channel, msg);
  expect(channel.nack).toHaveBeenCalledExactlyOnceWith(msg, false, false);
  expect(channel.ack).not.toHaveBeenCalled();
});

it.each([null, {}, { url: 'https://example.com' }])('dead-letters invalid job %s', async (body) => {
  const msg = message(body);

  await processJob(channel, msg);
  expect(channel.nack).toHaveBeenCalledExactlyOnceWith(msg, false, false);
  expect(pdfService.generatePdfFromUrl).not.toHaveBeenCalled();
});

it('removes unknown PDF options, including filesystem paths', async () => {
  await processJob(channel, message({ ...job, options: { path: '/tmp/evil', landscape: true } }));
  expect(pdfService.generatePdfFromUrl).toHaveBeenCalledWith(job.url, { landscape: true });
});
