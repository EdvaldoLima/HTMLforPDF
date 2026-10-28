import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { jobValidator } from '../validators/pdfValidator.js';
import { config } from '../config/env.js';
import pdfService from '../services/pdfService.js';
import webhookService from '../services/webhookService.js';
import { sendConfirmed } from '../services/queueService.js';
import logger from '../utils/logger.js';

export async function processJob(channel: ConfirmChannel, message: ConsumeMessage) {
  let job;
  try {
    if (message.content.length > 100 * 1024) throw new Error('Message too large');
    job = await jobValidator.validate(JSON.parse(message.content.toString('utf8')));
  } catch {
    logger.warn('Invalid job sent to dead-letter queue');
    channel.nack(message, false, false);
    return;
  }
  let failed = false;
  try {
    const buffer = await pdfService.generatePdfFromUrl(job.url, job.options);
    if (!(await webhookService.sendPdfToWebhook(buffer, job.webhookUrl, job.jobId))) {
      throw new Error('Webhook delivery failed');
    }
  } catch (error) {
    failed = true;
    logger.error('Job processing failed', { jobId: job.jobId, error });
  }
  if (!failed) {
    channel.ack(message);
    return;
  }
  const value = message.properties.headers?.['x-attempt'];
  const attempt = Number.isSafeInteger(value) && value >= 0 ? Number(value) : 0;
  if (attempt >= config.maxAttempts - 1) {
    channel.nack(message, false, false);
    return;
  }
  // The original remains unacknowledged until the retry is accepted by RabbitMQ.
  await sendConfirmed(channel, `${config.queue}.retry`, Buffer.from(JSON.stringify(job)), {
    messageId: job.jobId,
    contentType: 'application/json',
    headers: { 'x-attempt': attempt + 1 },
  });
  channel.ack(message);
}
