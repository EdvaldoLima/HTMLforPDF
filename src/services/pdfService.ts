import type { PdfOptions } from '../types/job.js';
import { chromium, type Browser } from 'playwright';
import { config } from '../config/env.js';
import { resolvePublicUrl, parsePublicUrl } from '../security/network.js';
import { createBrowserProxy } from '../security/browserProxy.js';
import { PublicError } from '../utils/errors.js';
import { buildPdfOptions } from '../utils/pdfOptions.js';

let active = 0;
const browsers = new Set<Browser>();

export async function closeBrowsers() {
  await Promise.allSettled([...browsers].map((browser) => browser.close()));
}

async function generatePdfFromUrl(url: string, options?: PdfOptions): Promise<Buffer> {
  if (active >= config.maxRenders) throw new PublicError(503, 'Rendering capacity reached');
  active++;

  let browser: Browser | undefined;
  let proxy: Awaited<ReturnType<typeof createBrowserProxy>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resourceRequests = 0;
  let requestLimitExceeded = false;
  const networkLimitExceeded = () => requestLimitExceeded || Boolean(proxy?.hasExceededBudget());
  const deadline = Date.now() + config.renderTimeout;

  try {
    // DNS lookup has its own finite deadline before browser creation.
    await Promise.race([
      resolvePublicUrl(url),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PublicError(504, 'Rendering timed out')),
          config.renderTimeout,
        );
      }),
    ]);

    clearTimeout(timer);
    proxy = await createBrowserProxy(config.maxNetworkBytes, config.maxNetworkRequests);

    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      timeout: Math.max(1, deadline - Date.now()),
      proxy: { server: proxy.url, bypass: '<-loopback>' },
      args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    });

    browsers.add(browser);

    const currentBrowser = browser;

    const render = async () => {
      const context = await currentBrowser.newContext({
        serviceWorkers: 'block',
        acceptDownloads: false,
      });

      await context.route('**/*', (route) => {
        resourceRequests++;

        if (resourceRequests > config.maxNetworkRequests) {
          requestLimitExceeded = true;

          return route.abort('blockedbyclient');
        }

        try {
          parsePublicUrl(route.request().url());

          return route.continue();
        } catch {
          return route.abort('blockedbyclient');
        }
      });

      await context.routeWebSocket('**/*', (socket) => socket.close());

      const page = await context.newPage();

      page.setDefaultTimeout(Math.max(1, deadline - Date.now()));

      const response = await page.goto(url, { waitUntil: 'load' });

      if (!response || !response.ok()) {
        if (response && (response.status() >= 500 || [408, 429].includes(response.status()))) {
          throw new PublicError(503, 'Source page is temporarily unavailable');
        }

        throw new PublicError(422, 'Source page returned an error');
      }

      if (networkLimitExceeded()) throw new PublicError(422, 'Page exceeds network limits');

      const buffer = await page.pdf(buildPdfOptions(options)).catch((error: unknown) => {
        if (error instanceof Error && error.message.includes('Page range exceeds page count')) {
          throw new PublicError(422, 'Requested page range exceeds the document page count');
        }

        throw error;
      });

      if (networkLimitExceeded()) throw new PublicError(422, 'Page exceeds network limits');
      if (buffer.length > config.maxPdfBytes) throw new PublicError(422, 'PDF exceeds size limit');

      return buffer;
    };

    return await Promise.race([
      render(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PublicError(504, 'Rendering timed out')),
          Math.max(1, deadline - Date.now()),
        );
      }),
    ]);
  } catch (error) {
    if (networkLimitExceeded()) throw new PublicError(422, 'Page exceeds network limits');

    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new PublicError(504, 'Rendering timed out');
    }

    throw error;
  } finally {
    clearTimeout(timer);

    try {
      if (browser) await browser.close();
    } finally {
      if (browser) browsers.delete(browser);

      try {
        await proxy?.close();
      } finally {
        active--;
      }
    }
  }
}

export default { generatePdfFromUrl };
