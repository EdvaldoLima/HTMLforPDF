import logger from '@/utils/logger.js';
import { fetch, FormData } from 'undici';

async function sendPdfToWebhook(buffer: Buffer, webhookUrl: string): Promise<boolean> {
  try {
    const data = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });
    data.append('file', blob, 'file.pdf');

    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: data,
    });

    if (response.status < 200 || response.status >= 300) {
      const txt = await response.text().catch(() => '');

      logger.error('[webhook] webhook returned non-2xx', {
        status: response.status,
        body: txt,
        webhookUrl,
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('[webhook] failed to send PDF to webhook', {
      error: (error as Error).message,
      webhookUrl,
    });
    return false;
  }
}

export default { sendPdfToWebhook };
