import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'node:dns/promises';
import {
  isPublicAddress,
  parsePublicUrl,
  resolvePublicUrl,
  publicDispatcher,
} from '../src/security/network.js';
import { createBrowserProxy } from '../src/security/browserProxy.js';
import { request } from 'node:http';
import { connect } from 'node:net';
import { fetch } from 'undici';

afterEach(() => vi.resetAllMocks());

describe('destination policy', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])('rejects reserved IP %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    'https://127.0.0.1',
    'http://[::1]',
    'file:///etc/passwd',
    'http://user:pass@example.com',
    'http://example.com:8080',
    'http://2130706433',
    'http://0x7f000001',
  ])('rejects URL %s', (url) => {
    expect(() => parsePublicUrl(url)).toThrow();
  });

  it('accepts public IPs', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('rejects mixed public/private DNS results', async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ] as never);

    await expect(resolvePublicUrl('https://example.com')).rejects.toThrow('Destination');
  });

  it('uses validated DNS addresses', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    expect((await resolvePublicUrl('https://example.com')).address).toBe('8.8.8.8');
  });

  it('blocks private DNS results at the webhook connection', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);

    const dispatcher = publicDispatcher();

    try {
      await expect(fetch('https://example.com', { dispatcher })).rejects.toThrow();
    } finally {
      await dispatcher.destroy();
    }
  });

  it('blocks HTTP requests through the browser proxy', async () => {
    const proxy = await createBrowserProxy(1000);

    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        request(proxy.url, { path: 'http://127.0.0.1/' }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
          .on('error', reject)
          .end();
      });

      expect(status).toBe(403);
    } finally {
      await proxy.close();
    }
  });

  it('blocks CONNECT tunnels to private destinations', async () => {
    const proxy = await createBrowserProxy(1000);

    try {
      const received = await new Promise<string>((resolve, reject) => {
        const socket = connect(Number(new URL(proxy.url).port), '127.0.0.1');
        let data = '';

        socket.on('connect', () =>
          socket.write('CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n'),
        );

        socket.on('data', (chunk) => {
          data += chunk.toString();
        });

        socket.on('close', () => resolve(data));
        socket.on('error', reject);
      });

      expect(received).not.toContain('200 Connection Established');
    } finally {
      await proxy.close();
    }
  });
});
