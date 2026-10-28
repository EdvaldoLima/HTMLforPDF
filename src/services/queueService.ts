import { randomUUID } from 'node:crypto';
import type { ConfirmChannel, Options, Message } from 'amqplib';
import { createChannel } from '../queue/rabbitmq.js';
import { config } from '../config/env.js';
import type { JobPayload } from '../types/job.js';
import { PublicError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export async function assertTopology(channel: ConfirmChannel) {
  await channel.assertQueue(`${config.queue}.dead`, {
    durable: true,
    arguments: { 'x-max-length': config.queueLimit, 'x-overflow': 'reject-publish' },
  });

  await channel.assertQueue(config.queue, {
    durable: true,
    arguments: {
      'x-max-length': config.queueLimit,
      'x-overflow': 'reject-publish',
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': `${config.queue}.dead`,
    },
  });

  await channel.assertQueue(`${config.queue}.retry`, {
    durable: true,
    arguments: {
      'x-message-ttl': 30_000,
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': config.queue,
      'x-max-length': config.queueLimit,
      'x-overflow': 'reject-publish',
    },
  });
}

export function sendConfirmed(
  channel: ConfirmChannel,
  queue: string,
  body: Buffer,
  properties: Options.Publish = {},
) {
  return new Promise<void>((resolve, reject) => {
    const correlationId = randomUUID();
    let settled = false;

    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.off('return', onReturn);
      channel.off('close', onClose);
      channel.off('error', onError);
      if (error) reject(error);
      else resolve();
    };

    const onReturn = (message: Message) => {
      if (message.properties.correlationId === correlationId) {
        finish(new Error('Job could not be routed to its queue'));
      }
    };

    const onClose = () => finish(new Error('Publisher channel closed before confirmation'));
    const onError = (error: Error) => finish(error);
    const timer = setTimeout(() => finish(new Error('Publisher confirmation timed out')), 10_000);

    timer.unref();
    channel.on('return', onReturn);
    channel.on('close', onClose);
    channel.on('error', onError);

    try {
      channel.sendToQueue(
        queue,
        body,
        {
          ...properties,
          persistent: true,
          mandatory: true,
          correlationId,
        },
        finish,
      );
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Publication failed'));
    }
  });
}

export async function publishJob(payload: JobPayload) {
  let channel: ConfirmChannel | undefined;

  try {
    channel = await createChannel();
    await assertTopology(channel);

    await sendConfirmed(channel, config.queue, Buffer.from(JSON.stringify(payload)), {
      messageId: payload.jobId,
      contentType: 'application/json',
    });
  } catch (error) {
    logger.error('Job publication failed', { jobId: payload.jobId, error });

    throw new PublicError(503, 'Job queue is temporarily unavailable');
  } finally {
    await channel?.close().catch(() => undefined);
  }
}

export default { publishJob };
