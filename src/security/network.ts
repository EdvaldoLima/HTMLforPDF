import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';
import { PublicError } from '../utils/errors.js';

export function isPublicAddress(address: string): boolean {
  try {
    // IPv4-mapped IPv6 and transition networks are deliberately rejected.
    return ipaddr.parse(address).range() === 'unicast';
  } catch {
    return false;
  }
}

export function parsePublicUrl(value: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new PublicError(422, 'Invalid URL');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== '80' && url.port !== '443')
  ) {
    throw new PublicError(
      422,
      'Only HTTP/HTTPS URLs on ports 80/443 without credentials are allowed',
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (ipaddr.isValid(host) && !isPublicAddress(host)) {
    throw new PublicError(422, 'Destination is not allowed');
  }

  return url;
}

async function lookupBounded(host: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PublicError(422, 'Destination resolution timed out')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function resolvePublicUrl(value: string) {
  const url = parsePublicUrl(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const records = await lookupBounded(host);

  if (!records.length || records.some(({ address }) => !isPublicAddress(address))) {
    throw new PublicError(422, 'Destination is not allowed');
  }

  return { url, address: records[0].address, family: records[0].family };
}

// DNS is checked at connection time; the validated address is the address used.
export function publicDispatcher(): Agent {
  return new Agent({
    connect: {
      timeout: 10_000,
      lookup(hostname, options, callback) {
        const host = hostname.replace(/^\[|\]$/g, '');

        lookupBounded(host)
          .then((records) => {
            if (!records.length || records.some(({ address }) => !isPublicAddress(address))) {
              callback(new Error('Destination is not allowed'), '', 4);
            } else if (options.all) {
              callback(null, records);
            } else {
              callback(null, records[0].address, records[0].family);
            }
          })
          .catch((err) => callback(err, '', 4));
      },
    },
  });
}
