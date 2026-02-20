import 'dotenv/config';
import { createChannel } from '@/queue/rabbitmq.js';
import pdfService from '@/services/pdfService.js';
import webhookService from '@/services/webhookService.js';
import type amqp from 'amqplib';
import logger from '@/utils/logger.js';
import type { JobPayload } from '@/types/job.js';

const QUEUE = process.env.PDF_QUEUE_NAME || 'html_for_pdf_job';

async function startWorker() {
  const channel = await createChannel();
  await channel.assertQueue(QUEUE, { durable: true });
  channel.prefetch(Number(process.env.WORKER_CONCURRENCY || 1));

  channel.consume(QUEUE, async (message: amqp.ConsumeMessage | null) => {
    if (!message) return;
    const raw = message.content?.toString?.('utf8') ?? '';

    if (!raw || raw.trim() === '') {
      logger.error('[worker] empty message body, discarding', { fields: message.fields });
      channel.nack(message, false, false);
      return;
    }

    let content: JobPayload | null = null;
    try {
      content = JSON.parse(raw) as JobPayload;
    } catch (err) {
      logger.error('[worker] invalid JSON message, discarding', {
        error: (err as Error).message,
        raw,
      });
      channel.nack(message, false, false);
      return;
    }

    const { url, webhookUrl, options } = content;

    try {
      const buffer = await pdfService.generatePdfFromUrl(url, options);

      if (webhookUrl) {
        await webhookService.sendPdfToWebhook(buffer, webhookUrl).then(() => {
          channel.nack(message, false, false);
        })
      }

      channel.ack(message);
    } catch (err) {
      logger.error('[worker] processing error', (err as Error).message);
      channel.nack(message, false, false);
    }
  });
}

startWorker().catch((err) => {
  logger.error('Failed to start worker', { error: err });
  process.exit(1);
});
