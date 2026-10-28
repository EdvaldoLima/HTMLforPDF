import express from 'express';
import { randomUUID } from 'node:crypto';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import pdfRoutes from './routes/pdfRoutes.js';
import { authenticate } from './middleware/access.js';
import { config } from './config/env.js';
import { createChannel } from './queue/rabbitmq.js';
import { assertTopology } from './services/queueService.js';
import logger from './utils/logger.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use((_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.set('X-Request-Id', res.locals.requestId);
  res.set('Cache-Control', 'no-store');
  next();
});
app.get('/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});
app.use(
  '/api/pdfs',
  rateLimit({
    windowMs: 60_000,
    limit: config.rateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
  authenticate,
  express.json({ limit: '100kb' }),
  pdfRoutes,
);
app.get('/health/ready', authenticate, async (_req, res) => {
  let channel;
  try {
    channel = await createChannel();
    await assertTopology(channel);
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  } finally {
    await channel?.close().catch(() => undefined);
  }
});
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next;
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 413 || status === 415) {
      res
        .status(status)
        .json({ error: status === 413 ? 'Request body too large' : 'Invalid request body' });
      return;
    }
    logger.error('Unhandled request error', { requestId: res.locals.requestId, error: err });
    res.status(500).json({ error: 'Unable to process request' });
  },
);
export default app;
