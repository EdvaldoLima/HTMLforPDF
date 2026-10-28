import { expect, it } from 'vitest';
import { generatePdfValidator } from '../src/validators/pdfValidator.js';
import { sanitize } from '../src/utils/logger.js';

it.each([-1, 0, '0mm', 100000, '999in', 'garbage', '1e8px'])(
  'rejects invalid width %s',
  async (width) => {
    await expect(
      generatePdfValidator.validate({ url: 'https://example.com', options: { width } }),
    ).rejects.toThrow();
  },
);

it('accepts valid PDF dimensions and margins', async () => {
  await expect(
    generatePdfValidator.validate({
      url: 'https://example.com',
      options: { width: '8.5in', margin: { top: '0mm' } },
    }),
  ).resolves.toBeDefined();
});

it('redacts sensitive log fields and exception URLs', () => {
  const value = JSON.stringify(
    sanitize({
      webhookUrl: 'https://user:pass@example.com?token=secret',
      apiKey: 'secret',
      error: new Error('secret'),
      message: 'failed https://example.com?token=secret',
    }),
  );

  expect(value).not.toContain('secret');
  expect(value).toContain('[redacted]');
});

it('serializes bigint and circular log metadata safely', () => {
  const value: Record<string, unknown> = { count: 1n };

  value.self = value;
  expect(() => JSON.stringify(sanitize(value))).not.toThrow();
});
