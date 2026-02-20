import pdfService from '@/services/pdfService.js';
import queueService from '@/services/queueService.js';
import { enqueuePdfValidator, generatePdfValidator } from '@/validators/pdfValidator.js';
import { errors } from '@vinejs/vine';
import { Request, Response } from 'express';

export async function generatePdf(req: Request, res: Response) {
  try {
    const { url, options } = await generatePdfValidator.validate(req.body);

    const buffer = await pdfService.generatePdfFromUrl(url, options);

    res.setHeader('Content-Type', 'application/pdf');
    return res.send(buffer);
  } catch (err) {
    if (err instanceof errors.E_VALIDATION_ERROR) {
      return res.status(422).json({ errors: err.messages });
    }
    return res.status(500).json({ error: (err as Error).message || 'Error generating PDF' });
  }
}

export async function enqueuePdf(req: Request, res: Response) {
  try {
    const { url, webhookUrl, options } = await enqueuePdfValidator.validate(req.body);

    await queueService.publishJob({ url, webhookUrl, options });
    return res.status(202).json({ status: 'queued' });
  } catch (err) {
    if (err instanceof errors.E_VALIDATION_ERROR) {
      return res.status(422).json({ errors: err.messages });
    }
    return res.status(500).json({ error: (err as Error).message || 'Error enqueueing job' });
  }
}
