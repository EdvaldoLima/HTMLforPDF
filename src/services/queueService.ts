import type { ConfirmChannel, Options } from 'amqplib';
import { createChannel } from '../queue/rabbitmq.js';
import { config } from '../config/env.js';
import type { JobPayload } from '../types/job.js';

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
    const timer = setTimeout(() => reject(new Error('Publisher confirmation timed out')), 10_000);

    timer.unref();

    try {
      channel.sendToQueue(queue, body, { ...properties, persistent: true }, (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

export async function publishJob(payload: JobPayload) {
  const channel = await createChannel();

  try {
    await assertTopology(channel);

    await sendConfirmed(channel, config.queue, Buffer.from(JSON.stringify(payload)), {
      messageId: payload.jobId,
      contentType: 'application/json',
    });
  } finally {
    await channel.close().catch(() => undefined);
  }
}

export default { publishJob };
