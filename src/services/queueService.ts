import { createChannel } from '@/queue/rabbitmq.js';

const QUEUE = process.env.PDF_QUEUE_NAME || 'html_for_pdf_job';

export async function publishJob(payload: Record<string, unknown>) {
  const ch = await createChannel();
  await ch.assertQueue(QUEUE, { durable: true });
  ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(payload)), { persistent: true });
  await ch.close();
}

export default { publishJob };
