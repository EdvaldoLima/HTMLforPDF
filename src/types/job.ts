import type { Page } from 'playwright';

export type PdfOptions = NonNullable<Parameters<Page['pdf']>[0]>;

export type JobPayload = {
    url: string;
    webhookUrl?: string;
    options?: PdfOptions;
};
