import { createServer, request } from 'node:http';
import { connect, type Socket } from 'node:net';
import { resolvePublicUrl } from './network.js';

// A per-render forward proxy pins connections to validated public IPs, including
// CONNECT tunnels. Redirects and subresources pass through the same policy.
export async function createBrowserProxy(maxBytes: number) {
  const sockets = new Set<Socket>();
  let bytes = 0;
  let closed = false;

  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(30_000, () => socket.destroy());
  };

  const budget = (size: number) => {
    bytes += size;

    if (bytes > maxBytes) {
      for (const socket of sockets) socket.destroy();

      return false;
    }

    return true;
  };

  const server = createServer((req, res) => {
    void (async () => {
      const { url, address, family } = await resolvePublicUrl(req.url ?? '');

      if (url.protocol !== 'http:') throw new Error('Use CONNECT for HTTPS');
      if (closed || res.destroyed || bytes > maxBytes) throw new Error('Network budget exceeded');

      const headers = { ...req.headers, host: url.host, connection: 'close' };

      delete headers['proxy-authorization'];

      const upstream = request(
        {
          hostname: address,
          family,
          port: Number(url.port || 80),
          path: url.pathname + url.search,
          method: req.method,
          headers,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);

          response.on('data', (chunk: Buffer) => {
            budget(chunk.length);
          });

          response.on('error', () => res.destroy());
          response.pipe(res);
        },
      );

      upstream.on('socket', track);

      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });

      req.on('aborted', () => upstream.destroy());
      res.on('close', () => upstream.destroy());
      req.pipe(upstream);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(403);
      res.end();
    });
  });

  server.on('connection', track);

  server.on('connect', (req, client, head) => {
    void (async () => {
      const { url, address, family } = await resolvePublicUrl(`https://${req.url}`);

      if (Number(url.port || 443) !== 443 || closed || client.destroyed || bytes > maxBytes)
        throw new Error('Tunnel refused');

      const upstream = connect({ host: address, family, port: 443 });

      track(upstream);
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());

      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);

        upstream.on('data', (chunk: Buffer) => {
          budget(chunk.length);
        });

        client.pipe(upstream);
        upstream.pipe(client);
      });
    })().catch(() => client.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('Proxy failed to start');

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
