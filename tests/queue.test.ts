import { beforeEach, expect, it, vi } from 'vitest';
import type { ConfirmChannel } from 'amqplib';
import { EventEmitter } from 'node:events';

vi.mock('../src/queue/rabbitmq.js', () => ({ createChannel: vi.fn() }));
import { sendConfirmed, publishJob } from '../src/services/queueService.js';
import { createChannel } from '../src/queue/rabbitmq.js';

beforeEach(() => vi.resetAllMocks());

function fakeChannel(sendToQueue: unknown) {
  return Object.assign(new EventEmitter(), { sendToQueue }) as ConfirmChannel;
}

it('waits for broker confirmation instead of socket buffering', async () => {
  let confirm!: (error: Error | null) => void;
  const channel = fakeChannel(
    vi.fn((_queue, _body, _options, callback) => {
      confirm = callback;

      return false;
    }),
  );
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
  const channel = fakeChannel(
    vi.fn((_queue, _body, _options, callback) => {
      callback(new Error('queue full'));
    }),
  );

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
  ).rejects.toMatchObject({ status: 503 });

  expect(close).toHaveBeenCalledOnce();
});

it('rejects an unroutable publication even if the broker confirms it', async () => {
  const channel = fakeChannel(
    vi.fn((_queue, _body, options, callback) => {
      expect(options.mandatory).toBe(true);
      channel.emit('return', { properties: { correlationId: options.correlationId } });
      callback(null);
    }),
  );

  await expect(sendConfirmed(channel, 'missing', Buffer.from('job'))).rejects.toThrow('routed');
  expect(channel.listenerCount('return')).toBe(0);
  expect(channel.listenerCount('close')).toBe(0);
});

it('rejects immediately when the publisher channel closes', async () => {
  const channel = fakeChannel(vi.fn());
  const pending = sendConfirmed(channel, 'queue', Buffer.from('job'));

  channel.emit('close');

  await expect(pending).rejects.toThrow('closed');
  expect(channel.listenerCount('return')).toBe(0);
});

it('correlates returned messages separately for concurrent publications of the same job', async () => {
  const publications: Array<{ correlationId: string; callback: (error: Error | null) => void }> =
    [];
  const channel = fakeChannel(
    vi.fn((_queue, _body, options, callback) => {
      publications.push({ correlationId: options.correlationId, callback });
    }),
  );
  const first = sendConfirmed(channel, 'queue', Buffer.from('job'), { messageId: 'same-job' });
  const second = sendConfirmed(channel, 'queue', Buffer.from('job'), { messageId: 'same-job' });

  channel.emit('return', { properties: { correlationId: publications[0].correlationId } });
  publications[0].callback(null);
  publications[1].callback(null);

  await expect(first).rejects.toThrow('routed');
  await expect(second).resolves.toBeUndefined();
  expect(channel.listenerCount('return')).toBe(0);
});
