import type { PdfOptions } from '../types/job.js';

// Dimensions match Playwright's paper formats and unit conversion.
export const paperFormats = {
  Letter: [8.5, 11],
  Legal: [8.5, 14],
  Tabloid: [11, 17],
  Ledger: [17, 11],
  A0: [33.1, 46.8],
  A1: [23.4, 33.1],
  A2: [16.54, 23.4],
  A3: [11.7, 16.54],
  A4: [8.27, 11.7],
  A5: [5.83, 8.27],
  A6: [4.13, 5.83],
} as const;

const units: Record<string, number> = { px: 1, in: 96, cm: 37.8, mm: 3.78 };

export function dimensionInPixels(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;

  const match = /^(\d+(?:\.\d{1,2})?)(px|in|cm|mm)$/.exec(value);

  return match ? Number(match[1]) * units[match[2]] : NaN;
}

export function effectivePaperSize(options: PdfOptions): [number, number] {
  const format = options.format ?? 'A4';

  if (typeof format !== 'string') return [NaN, NaN];

  const paper = paperFormats[format as keyof typeof paperFormats];

  if (!paper) return [NaN, NaN];

  const width = dimensionInPixels(options.width ?? `${paper[0]}in`);
  const height = dimensionInPixels(options.height ?? `${paper[1]}in`);

  return options.landscape ? [height, width] : [width, height];
}

export function buildPdfOptions(options: PdfOptions = {}): PdfOptions {
  if (options.width !== undefined || options.height !== undefined) {
    return { printBackground: true, width: '8.27in', height: '11.7in', ...options };
  }

  return { format: 'A4', printBackground: true, ...options };
}
