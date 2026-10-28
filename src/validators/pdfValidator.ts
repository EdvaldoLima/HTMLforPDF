import vine from '@vinejs/vine';

const sizeRule = vine.createRule((value: unknown, options: { allowZero: boolean }, field) => {
  if (typeof value !== 'string') return;
  const match = /^(\d+(?:\.\d{1,2})?)(px|in|cm|mm)$/.exec(value);
  const units: Record<string, number> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
  if (
    !match ||
    (!options.allowZero && Number(match[1]) === 0) ||
    Number(match[1]) * units[match[2]] > 5000
  ) {
    field.report(
      'The {{ field }} must be a dimension up to 5000px using px, in, cm or mm',
      'dimension',
      field,
    );
  }
});
const dimension = (allowZero = false) => vine.string().maxLength(20).use(sizeRule({ allowZero }));

const pdfOptionsSchema = vine.object({
  scale: vine.number().min(0.1).max(2).optional(),
  displayHeaderFooter: vine.boolean().optional(),
  headerTemplate: vine.string().maxLength(10000).optional(),
  footerTemplate: vine.string().maxLength(10000).optional(),
  printBackground: vine.boolean().optional(),
  landscape: vine.boolean().optional(),
  pageRanges: vine
    .string()
    .maxLength(1000)
    .regex(/^\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*$/)
    .optional(),
  format: vine
    .enum(['Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'])
    .optional(),
  width: vine
    .union([
      vine.union.if((value) => typeof value === 'number', vine.number().min(1).max(5000)),
      vine.union.if((value) => typeof value === 'string', dimension()),
    ])
    .optional(),
  height: vine
    .union([
      vine.union.if((value) => typeof value === 'number', vine.number().min(1).max(5000)),
      vine.union.if((value) => typeof value === 'string', dimension()),
    ])
    .optional(),
  margin: vine
    .object({
      top: dimension(true).optional(),
      right: dimension(true).optional(),
      bottom: dimension(true).optional(),
      left: dimension(true).optional(),
    })
    .optional(),
  preferCSSPageSize: vine.boolean().optional(),
  tagged: vine.boolean().optional(),
  outline: vine.boolean().optional(),
});

export const generatePdfValidator = vine.compile(
  vine.object({
    url: vine
      .string()
      .maxLength(2048)
      .url({ protocols: ['http', 'https'], require_protocol: true }),
    options: pdfOptionsSchema.optional(),
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
    options: pdfOptionsSchema.optional(),
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
    options: pdfOptionsSchema.optional(),
  }),
);
