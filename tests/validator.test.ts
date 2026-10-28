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

const invalidOptions: unknown[] = [
  null,
  [],
  'A4',
  1,
  { scale: '1' },
  { scale: 0 },
  { scale: 2.01 },
  { scale: NaN },
  { scale: Infinity },
  { format: 'a4' },
  { format: 'invalid' },
  { format: { toString: 1 } },
  { headerTemplate: 12 },
  { footerTemplate: [] },
  { headerTemplate: 'a'.repeat(10001) },
  { width: 1 },
  { width: true },
  { height: null },
  { width: '2ft' },
  { height: -1 },
  { width: '0px' },
  { margin: [] },
  { margin: '1cm' },
  { margin: { top: -1 } },
  { margin: { left: null } },
  { margin: { horizontal: '1cm' } },
  { path: '/tmp/file.pdf' },
  { unknown: true },
  { format: 'A4', width: '10cm' },
  { format: 'A4', height: 500 },
  { margin: { left: '5in', right: '5in' } },
  { width: 100, height: 100, margin: { top: 50, bottom: 50 } },
  { width: 100, height: 100, margin: { left: 100 } },
  { pageRanges: '2-1' },
  { pageRanges: '0' },
  { pageRanges: '1-0' },
  { pageRanges: '-1' },
  { pageRanges: '1,,2' },
  { pageRanges: '4294967296' },
  { pageRanges: '1.5' },
  { pageRanges: 'abc' },
  { pageRanges: '1-2-3' },
];

it.each(invalidOptions)('rejects invalid options %# before generation', async (options) => {
  await expect(
    generatePdfValidator.validate({ url: 'https://example.com', options }),
  ).rejects.toThrow();
});

it.each([
  'displayHeaderFooter',
  'printBackground',
  'landscape',
  'preferCSSPageSize',
  'tagged',
  'outline',
])('enforces a real boolean for %s', async (key) => {
  for (const value of ['true', 'false', 1, 0, null, {}, []]) {
    await expect(
      generatePdfValidator.validate({ url: 'https://example.com', options: { [key]: value } }),
    ).rejects.toThrow();
  }

  for (const value of [true, false]) {
    await expect(
      generatePdfValidator.validate({ url: 'https://example.com', options: { [key]: value } }),
    ).resolves.toBeDefined();
  }
});

it.each([
  {},
  { pageRanges: '' },
  { headerTemplate: '', footerTemplate: '' },
  { scale: 0.1 },
  { scale: 2 },
  { format: 'A0' },
  { width: 100, height: '100px', margin: { top: 10, bottom: '10px', left: '0mm', right: 0 } },
  { pageRanges: '1-5, 8, 11-13' },
  { pageRanges: '1 - 5, 8' },
  { format: 'A6', landscape: true, margin: { left: '5in' } },
])('accepts valid options %#', async (options) => {
  await expect(
    generatePdfValidator.validate({ url: 'https://example.com', options }),
  ).resolves.toBeDefined();
});

it('preserves safe operational error codes and public statuses in logs', () => {
  const error = Object.assign(new Error('amqp://secret@broker'), {
    code: 'ECONNRESET',
    status: 503,
  });

  expect(sanitize(error)).toEqual({ name: 'Error', code: 'ECONNRESET', status: 503 });
  expect(JSON.stringify(sanitize(error))).not.toContain('secret');
});
