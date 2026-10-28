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
const route = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  close.mockResolvedValue(undefined);
  proxyClose.mockResolvedValue(undefined);
  goto.mockResolvedValue({ ok: () => true });
  pdf.mockResolvedValue(Buffer.from('pdf'));

  vi.mocked(createBrowserProxy).mockResolvedValue({
    url: 'http://127.0.0.1:9999',
    close: proxyClose,
    hasExceededBudget: () => false,
  });

  vi.mocked(chromium.launch).mockResolvedValue({
    close,
    newContext: vi.fn().mockResolvedValue({
      route,
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

it('closes browser after invalid PDF options and allows the next render', async () => {
  const original = config.maxRenders;

  config.maxRenders = 1;
  pdf.mockRejectedValueOnce(new Error('page.pdf: Page ranges syntax error'));

  try {
    await expect(
      pdfService.generatePdfFromUrl('https://example.com', { pageRanges: '2-1' }),
    ).rejects.toThrow('Page ranges syntax error');

    expect(close).toHaveBeenCalledOnce();
    expect(proxyClose).toHaveBeenCalledOnce();

    await expect(pdfService.generatePdfFromUrl('https://example.com')).resolves.toEqual(
      Buffer.from('pdf'),
    );

    expect(close).toHaveBeenCalledTimes(2);
    expect(proxyClose).toHaveBeenCalledTimes(2);
  } finally {
    config.maxRenders = original;
  }
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

it('passes custom dimensions without overriding them with default A4 format', async () => {
  await pdfService.generatePdfFromUrl('https://example.com', { width: '100mm', height: '200mm' });

  expect(pdf).toHaveBeenCalledWith({ printBackground: true, width: '100mm', height: '200mm' });
});

it('returns a safe validation error if the requested page does not exist', async () => {
  pdf.mockRejectedValueOnce(
    new Error('page.pdf: Protocol error (Page.printToPDF): Page range exceeds page count'),
  );

  await expect(
    pdfService.generatePdfFromUrl('https://example.com', { pageRanges: '999' }),
  ).rejects.toMatchObject({
    status: 422,
    message: 'Requested page range exceeds the document page count',
  });

  expect(close).toHaveBeenCalledOnce();
  expect(proxyClose).toHaveBeenCalledOnce();
});

it('rejects a partial render after exhausting its network budget', async () => {
  vi.mocked(createBrowserProxy).mockResolvedValueOnce({
    url: 'http://127.0.0.1:9999',
    close: proxyClose,
    hasExceededBudget: () => true,
  });

  await expect(pdfService.generatePdfFromUrl('https://example.com')).rejects.toMatchObject({
    status: 422,
  });

  expect(pdf).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it('maps browser navigation timeouts to HTTP 504', async () => {
  const error = new Error('navigation timeout');

  error.name = 'TimeoutError';
  goto.mockRejectedValueOnce(error);

  await expect(pdfService.generatePdfFromUrl('https://example.com')).rejects.toMatchObject({
    status: 504,
  });

  expect(close).toHaveBeenCalledOnce();
});

it.each([408, 429, 500, 503])('keeps source HTTP %s failures retryable', async (status) => {
  goto.mockResolvedValueOnce({ ok: () => false, status: () => status });

  await expect(pdfService.generatePdfFromUrl('https://example.com')).rejects.toMatchObject({
    status: 503,
  });
});

it('bounds browser resource requests inside encrypted connections', async () => {
  const original = config.maxNetworkRequests;

  config.maxNetworkRequests = 1;

  goto.mockImplementationOnce(async () => {
    const handler = route.mock.calls[0][1];
    const resource = {
      request: () => ({ url: () => 'https://example.com/resource' }),
      continue: vi.fn(),
      abort: vi.fn(),
    };

    await handler(resource);
    await handler(resource);
    expect(resource.abort).toHaveBeenCalledOnce();

    return { ok: () => true };
  });

  try {
    await expect(pdfService.generatePdfFromUrl('https://example.com')).rejects.toMatchObject({
      status: 422,
    });

    expect(pdf).not.toHaveBeenCalled();
  } finally {
    config.maxNetworkRequests = original;
  }
});
