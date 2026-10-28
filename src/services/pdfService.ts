import type { PdfOptions } from '../types/job.js';
import { chromium, type Browser } from 'playwright';
import { config } from '../config/env.js';
import { resolvePublicUrl, parsePublicUrl } from '../security/network.js';
import { createBrowserProxy } from '../security/browserProxy.js';
import { PublicError } from '../utils/errors.js';

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
    proxy = await createBrowserProxy(config.maxNetworkBytes);
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
      if (!response || !response.ok()) throw new PublicError(422, 'Source page returned an error');
      const buffer = await page.pdf({ format: 'A4', printBackground: true, ...options });
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
