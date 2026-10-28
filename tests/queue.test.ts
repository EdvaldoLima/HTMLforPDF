import { beforeEach, expect, it, vi } from 'vitest';
import type { ConfirmChannel } from 'amqplib';

vi.mock('../src/queue/rabbitmq.js', () => ({ createChannel: vi.fn() }));
import { sendConfirmed, publishJob } from '../src/services/queueService.js';
import { createChannel } from '../src/queue/rabbitmq.js';

beforeEach(() => vi.resetAllMocks());

it('waits for broker confirmation instead of socket buffering', async () => {
  let confirm!: (error: Error | null) => void;
  const channel = {
    sendToQueue: vi.fn((_queue, _body, _options, callback) => {
      confirm = callback;

      return false;
    }),
  } as unknown as ConfirmChannel;
  let settled = false;
  const pending = sendConfirmed(channel, 'queue', Buffer.from('job')).then(() => {
    settled = true;
  });

  await Promise.resolve();
  expect(settled).toBe(false);
  confirm(null);
  await pending;
  expect(settled).toBe(true);
});

it('propagates broker rejection', async () => {
  const channel = {
    sendToQueue: vi.fn((_queue, _body, _options, callback) => {
      callback(new Error('queue full'));
    }),
  } as unknown as ConfirmChannel;

  await expect(sendConfirmed(channel, 'queue', Buffer.from('job'))).rejects.toThrow('queue full');
});

it('closes publication channel even if topology fails', async () => {
  const close = vi.fn().mockResolvedValue(undefined);

  vi.mocked(createChannel).mockResolvedValue({
    assertQueue: vi.fn().mockRejectedValue(new Error('conflict')),
    close,
  } as never);

  await expect(
    publishJob({ jobId: 'id', url: 'https://example.com', webhookUrl: 'https://example.org' }),
  ).rejects.toThrow('conflict');

  expect(close).toHaveBeenCalledOnce();
});
