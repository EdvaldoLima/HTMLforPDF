import { createChannel, closeConnection } from '../queue/rabbitmq.js';
import { assertTopology } from '../services/queueService.js';
import { processJob } from './processJob.js';
import { closeBrowsers } from '../services/pdfService.js';
import { config } from '../config/env.js';
import logger from '../utils/logger.js';
import type { ConfirmChannel } from 'amqplib';

if (config.concurrency > config.maxRenders) {
  throw new Error('WORKER_CONCURRENCY must not exceed MAX_CONCURRENT_RENDERS');
}

let stopping = false;
let current: ConfirmChannel | undefined;
let consumerTag: string | undefined;
const inflight = new Set<Promise<void>>();
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

async function run() {
  while (!stopping) {
    try {
      const channel = await createChannel();

      current = channel;

      const closed = new Promise<void>((resolve) => channel.once('close', resolve));

      await assertTopology(channel);
      await channel.prefetch(config.concurrency);

      const consumer = await channel.consume(config.queue, (message) => {
        if (!message) {
          void channel.close().catch(() => undefined);

          return;
        }

        const task = processJob(channel, message).catch(async (error) => {
          logger.error('Consumer channel failed; unacknowledged jobs will be redelivered', {
            error,
          });

          await channel.close().catch(() => undefined);
        });

        inflight.add(task);
        void task.finally(() => inflight.delete(task));
      });

      consumerTag = consumer.consumerTag;
      logger.info('Worker ready');
      await closed;
    } catch (error) {
      logger.error('Worker connection failed', { error });
    } finally {
      await current?.close().catch(() => undefined);
      current = undefined;
      consumerTag = undefined;
    }

    if (!stopping)
      await new Promise<void>((resolve) => {
        reconnectTimer = setTimeout(resolve, 3000);
      });
  }
}

async function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(reconnectTimer);

  const deadline = setTimeout(
    () => process.exit(1),
    config.renderTimeout + config.webhookTimeout + 15_000,
  );

  deadline.unref();

  try {
    if (current && consumerTag) await current.cancel(consumerTag).catch(() => undefined);
    await Promise.allSettled([...inflight]);
    await closeBrowsers();
    await current?.close().catch(() => undefined);
    await closeConnection().catch(() => undefined);
  } finally {
    process.exit(0);
  }
}

process.once('SIGTERM', () => {
  void stop();
});

process.once('SIGINT', () => {
  void stop();
});

void run();
