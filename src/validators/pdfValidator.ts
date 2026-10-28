import vine from '@vinejs/vine';

import type { PdfOptions } from '../types/job.js';
import { dimensionInPixels, effectivePaperSize } from '../utils/pdfOptions.js';

const nonNullRule = vine.createRule(
  (value: unknown, _options: undefined, field) => {
    if (value === null) field.report('The {{ field }} must not be null', 'notNull', field);
  },
  { implicit: true },
);

const knownFields = vine.createRule((value: unknown, allowed: string[], field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;

  for (const key of Object.keys(value)) {
    if ((value as Record<string, unknown>)[key] === null) {
      field.report('Field "{{ key }}" in {{ field }} must not be null', 'notNull', field, { key });
    }

    if (!allowed.includes(key)) {
      field.report('Unknown field "{{ key }}" in {{ field }}', 'unknownField', field, { key });
    }
  }
});

const sizeRule = vine.createRule((value: unknown, options: { allowZero: boolean }, field) => {
  const pixels = dimensionInPixels(value);

  if (!Number.isFinite(pixels) || pixels < (options.allowZero ? 0 : 1) || pixels > 5000) {
    field.report(
      'The {{ field }} must be a dimension up to 5000px using px, in, cm or mm',
      'dimension',
      field,
    );
  }
});
const dimension = (allowZero = false) =>
  vine.union([
    vine.union.if(
      (value) => typeof value === 'number',
      vine.number({ strict: true }).use(sizeRule({ allowZero })),
    ),
    vine.union.if(
      (value) => typeof value === 'string',
      vine.string().maxLength(20).use(sizeRule({ allowZero })),
    ),
  ]);

const pageRangesRule = vine.createRule((value: unknown, _options: undefined, field) => {
  if (typeof value !== 'string' || value === '') return;

  const valid =
    /^\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*$/.test(value) &&
    value.split(',').every((range) => {
      const [start, end = start] = range
        .trim()
        .split(/\s*-\s*/)
        .map(Number);

      // Chromium parses page indexes as unsigned 32-bit integers.
      return Number.isInteger(start) && start >= 1 && start <= end && end <= 4294967295;
    });

  if (!valid)
    field.report(
      'The {{ field }} must contain positive, ascending page ranges, e.g. "1-5, 8"',
      'pageRanges',
      field,
    );
});

const layoutRule = vine.createRule((value: unknown, _options: undefined, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;

  const options = value as PdfOptions;

  if (
    options.format !== undefined &&
    (options.width !== undefined || options.height !== undefined)
  ) {
    field.report('Use format or width/height, not both', 'paperSizeConflict', field);

    return;
  }

  const [width, height] = effectivePaperSize(options);
  const margin = options.margin ?? {};

  if (!margin || typeof margin !== 'object' || Array.isArray(margin)) return;

  const horizontal = dimensionInPixels(margin.left ?? 0) + dimensionInPixels(margin.right ?? 0);
  const vertical = dimensionInPixels(margin.top ?? 0) + dimensionInPixels(margin.bottom ?? 0);

  // Chromium uses integer print points (72/in); require at least one point of content.
  if (
    Math.floor(width * 0.75) - Math.floor(horizontal * 0.75) < 1 ||
    Math.floor(height * 0.75) - Math.floor(vertical * 0.75) < 1
  ) {
    field.report(
      'Margins must leave a printable area inside the paper size',
      'printableArea',
      field,
    );
  }
});

const marginProperties = {
  top: dimension(true).optional(),
  right: dimension(true).optional(),
  bottom: dimension(true).optional(),
  left: dimension(true).optional(),
};

const pdfOptionProperties = {
  scale: vine.number({ strict: true }).min(0.1).max(2).optional().use(nonNullRule()),
  displayHeaderFooter: vine.boolean({ strict: true }).optional().use(nonNullRule()),
  headerTemplate: vine.string().maxLength(10000).optional().use(nonNullRule()),
  footerTemplate: vine.string().maxLength(10000).optional().use(nonNullRule()),
  printBackground: vine.boolean({ strict: true }).optional().use(nonNullRule()),
  landscape: vine.boolean({ strict: true }).optional().use(nonNullRule()),
  pageRanges: vine.string().maxLength(1000).use(pageRangesRule()).optional().use(nonNullRule()),
  format: vine
    .enum(['Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'])
    .optional()
    .use(nonNullRule()),
  width: dimension().optional(),
  height: dimension().optional(),
  margin: vine
    .object(marginProperties)
    .use(knownFields(Object.keys(marginProperties)))
    .optional()
    .use(nonNullRule()),
  preferCSSPageSize: vine.boolean({ strict: true }).optional().use(nonNullRule()),
  tagged: vine.boolean({ strict: true }).optional().use(nonNullRule()),
  outline: vine.boolean({ strict: true }).optional().use(nonNullRule()),
};

const pdfOptionsSchema = vine
  .object(pdfOptionProperties)
  .use(knownFields(Object.keys(pdfOptionProperties)))
  .use(layoutRule());

export const generatePdfValidator = vine.compile(
  vine.object({
    url: vine
      .string()
      .maxLength(2048)
      .url({ protocols: ['http', 'https'], require_protocol: true }),
    options: pdfOptionsSchema.optional().use(nonNullRule()),
  }),
);

export const enqueuePdfValidator = vine.compile(
  vine.object({
    url: vine
      .string()
      .maxLength(2048)
      .url({ protocols: ['http', 'https'], require_protocol: true }),
    webhookUrl: vine
      .string()
      .maxLength(2048)
      .url({ protocols: ['http', 'https'], require_protocol: true }),
    options: pdfOptionsSchema.optional().use(nonNullRule()),
  }),
);

export const jobValidator = vine.compile(
  vine.object({
    jobId: vine.string().uuid(),
    url: vine
      .string()
      .maxLength(2048)
      .url({ protocols: ['http', 'https'], require_protocol: true }),
    webhookUrl: vine
      .string()
      .maxLength(2048)
      .url({ protocols: ['http', 'https'], require_protocol: true }),
    options: pdfOptionsSchema.optional().use(nonNullRule()),
  }),
);
