import vine from '@vinejs/vine';

const pdfOptionsSchema = vine.object({
    scale: vine.number().min(0.1).max(2).optional(),
    displayHeaderFooter: vine.boolean().optional(),
    headerTemplate: vine.string().optional(),
    footerTemplate: vine.string().optional(),
    printBackground: vine.boolean().optional(),
    landscape: vine.boolean().optional(),
    pageRanges: vine.string().optional(),
    format: vine.enum(['Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6']).optional(),
    width: vine.union([
        vine.union.if((value) => typeof value === 'number', vine.number()),
        vine.union.if((value) => typeof value === 'string', vine.string()),
    ]).optional(),
    height: vine.union([
        vine.union.if((value) => typeof value === 'number', vine.number()),
        vine.union.if((value) => typeof value === 'string', vine.string()),
    ]).optional(),
    margin: vine.object({
        top: vine.string().optional(),
        right: vine.string().optional(),
        bottom: vine.string().optional(),
        left: vine.string().optional(),
    }).optional(),
    preferCSSPageSize: vine.boolean().optional(),
    tagged: vine.boolean().optional(),
    outline: vine.boolean().optional(),
});

export const generatePdfValidator = vine.compile(
    vine.object({
        url: vine.string().url(),
        options: pdfOptionsSchema.optional(),
    })
);

export const enqueuePdfValidator = vine.compile(
    vine.object({
        url: vine.string().url(),
        webhookUrl: vine.string().url(),
        options: pdfOptionsSchema.optional(),
    })
);
