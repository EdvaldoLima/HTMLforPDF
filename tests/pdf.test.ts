import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));

vi.mock('../src/security/network.js', () => ({
  resolvePublicUrl: vi.fn().mockResolvedValue({}),
  parsePublicUrl: vi.fn(),
}));

vi.mock('../src/security/browserProxy.js', () => ({ createBrowserProxy: vi.fn() }));
import { chromium } from 'playwright';
import { createBrowserProxy } from '../src/security/browserProxy.js';
import pdfService from '../src/services/pdfService.js';
import { config } from '../src/config/env.js';

const close = vi.fn();
const proxyClose = vi.fn();
const goto = vi.fn();
const pdf = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  close.mockResolvedValue(undefined);
  proxyClose.mockResolvedValue(undefined);
  goto.mockResolvedValue({ ok: () => true });
  pdf.mockResolvedValue(Buffer.from('pdf'));

  vi.mocked(createBrowserProxy).mockResolvedValue({
    url: 'http://127.0.0.1:9999',
    close: proxyClose,
  });

  vi.mocked(chromium.launch).mockResolvedValue({
    close,
    newContext: vi.fn().mockResolvedValue({
      route: vi.fn(),
      routeWebSocket: vi.fn(),
      newPage: vi.fn().mockResolvedValue({ setDefaultTimeout: vi.fn(), goto, pdf }),
    }),
  } as never);
});

it('closes browser and proxy after navigation failure', async () => {
  goto.mockRejectedValue(new Error('navigation failed'));

  await expect(pdfService.generatePdfFromUrl('https://example.com')).rejects.toThrow(
    'navigation failed',
  );

  expect(close).toHaveBeenCalledOnce();
  expect(proxyClose).toHaveBeenCalledOnce();
});

it('cleans proxy if browser launch fails', async () => {
  vi.mocked(chromium.launch).mockRejectedValueOnce(new Error('launch failed'));

  await expect(pdfService.generatePdfFromUrl('https://example.com')).rejects.toThrow(
    'launch failed',
  );

  expect(proxyClose).toHaveBeenCalledOnce();
});

it('times out a stalled PDF and closes browser', async () => {
  const original = config.renderTimeout;

  config.renderTimeout = 20;
  pdf.mockReturnValue(new Promise(() => undefined));

  try {
    await expect(pdfService.generatePdfFromUrl('https://example.com')).rejects.toThrow('timed out');
    expect(close).toHaveBeenCalledOnce();
  } finally {
    config.renderTimeout = original;
  }
});

it('rejects excess concurrency and releases capacity after failure', async () => {
  const original = config.maxRenders;

  config.maxRenders = 1;

  let rejectNavigation!: (error: Error) => void;

  goto.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectNavigation = reject;
      }),
  );

  const pending = pdfService.generatePdfFromUrl('https://example.com');

  await vi.waitFor(() => expect(goto).toHaveBeenCalled());
  await expect(pdfService.generatePdfFromUrl('https://example.com')).rejects.toThrow('capacity');
  rejectNavigation(new Error('failed'));
  await expect(pending).rejects.toThrow();

  await expect(pdfService.generatePdfFromUrl('https://example.com')).resolves.toEqual(
    Buffer.from('pdf'),
  );

  config.maxRenders = original;
});
