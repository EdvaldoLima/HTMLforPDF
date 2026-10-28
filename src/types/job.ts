import type { Page } from 'playwright';

export type PdfOptions = Omit<NonNullable<Parameters<Page['pdf']>[0]>, 'path'>;
export type JobPayload = {
  jobId: string;
  url: string;
  webhookUrl: string;
  options?: PdfOptions;
};
