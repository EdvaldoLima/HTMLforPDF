import 'dotenv/config';

export function integer(name: string, fallback: number, max = 1_000_000): number {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`Invalid configuration: ${name}`);
  }

  return value;
}

export const config = {
  port: integer('PORT', 3000, 65535),
  apiKey: process.env.API_KEY ?? '',
  queue: process.env.PDF_QUEUE_NAME || 'html_for_pdf_job_v2',
  rabbitUrl: process.env.RABBITMQ_URL || 'amqp://localhost',
  concurrency: integer('WORKER_CONCURRENCY', 1, 16),
  maxRenders: integer('MAX_CONCURRENT_RENDERS', 2, 16),
  renderTimeout: integer('RENDER_TIMEOUT_MS', 45_000, 300_000),
  webhookTimeout: integer('WEBHOOK_TIMEOUT_MS', 15_000, 120_000),
  maxPdfBytes: integer('MAX_PDF_BYTES', 20 * 1024 * 1024, 100 * 1024 * 1024),
  maxNetworkBytes: integer('MAX_NETWORK_BYTES', 50 * 1024 * 1024, 200 * 1024 * 1024),
  maxAttempts: integer('JOB_MAX_ATTEMPTS', 3, 10),
  queueLimit: integer('QUEUE_MAX_LENGTH', 10_000),
  rateLimit: integer('RATE_LIMIT_PER_MINUTE', 30, 10_000),
};
