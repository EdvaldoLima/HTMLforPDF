import type { PdfOptions } from '@/types/job.js';
import { chromium } from 'playwright';

async function generatePdfFromUrl(url: string, options?: PdfOptions): Promise<Buffer> {

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });

  const pdfData = await page.pdf({
    format: 'A4',
    printBackground: true,
    ...options,
  });
  await browser.close();

  return Buffer.from(pdfData);
}

export default { generatePdfFromUrl };
