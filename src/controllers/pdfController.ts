import { randomUUID } from 'node:crypto';
import pdfService from '../services/pdfService.js';
import queueService from '../services/queueService.js';
import { enqueuePdfValidator, generatePdfValidator } from '../validators/pdfValidator.js';
import { errors } from '@vinejs/vine';
import type { Request, Response } from 'express';
import { PublicError } from '../utils/errors.js';
import { resolvePublicUrl } from '../security/network.js';
import logger from '../utils/logger.js';

function failure(err: unknown, res: Response) {
  if (err instanceof errors.E_VALIDATION_ERROR)
    return res.status(422).json({ errors: err.messages });
  if (err instanceof PublicError) return res.status(err.status).json({ error: err.message });
  logger.error('Request failed', { requestId: res.locals.requestId, error: err });

  return res
    .status(500)
    .json({ error: 'Unable to process request', requestId: res.locals.requestId });
}

export async function generatePdf(req: Request, res: Response) {
  try {
    const { url, options } = await generatePdfValidator.validate(req.body);
    const buffer = await pdfService.generatePdfFromUrl(url, options);

    return res
      .type('application/pdf')
      .set('Content-Disposition', 'attachment; filename="file.pdf"')
      .send(buffer);
  } catch (err) {
    return failure(err, res);
  }
}

export async function enqueuePdf(req: Request, res: Response) {
  try {
    const { url, webhookUrl, options } = await enqueuePdfValidator.validate(req.body);

    await Promise.all([resolvePublicUrl(url), resolvePublicUrl(webhookUrl)]);

    const jobId = randomUUID();

    await queueService.publishJob({ jobId, url, webhookUrl, options });

    return res.status(202).json({ status: 'queued', jobId });
  } catch (err) {
    return failure(err, res);
  }
}
