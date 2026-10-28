import { fetch, FormData } from 'undici';
import { createHmac } from 'node:crypto';
import { config } from '../config/env.js';
import { parsePublicUrl, publicDispatcher } from '../security/network.js';
import logger from '../utils/logger.js';

async function sendPdfToWebhook(
  buffer: Buffer,
  webhookUrl: string,
  jobId: string,
): Promise<boolean> {
  const dispatcher = publicDispatcher();
  try {
    const url = parsePublicUrl(webhookUrl);
    const data = new FormData();
    data.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }),
      'file.pdf',
    );
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers: Record<string, string> = {
      'X-Job-Id': jobId,
      'Idempotency-Key': jobId,
      'X-Webhook-Timestamp': timestamp,
    };
    if (process.env.WEBHOOK_SECRET) {
      headers['X-Webhook-Signature'] = createHmac('sha256', process.env.WEBHOOK_SECRET)
        .update(`${timestamp}.${jobId}.`)
        .update(buffer)
        .digest('hex');
    }
    const response = await fetch(url, {
      method: 'POST',
      body: data,
      headers,
      dispatcher,
      redirect: 'error',
      signal: AbortSignal.timeout(config.webhookTimeout),
    });
    await response.body?.cancel();
    if (!response.ok) logger.warn('Webhook rejected delivery', { jobId, status: response.status });
    return response.ok;
  } catch (error) {
    logger.error('Webhook delivery failed', { jobId, error });
    return false;
  } finally {
    await dispatcher.destroy();
  }
}

export default { sendPdfToWebhook };
