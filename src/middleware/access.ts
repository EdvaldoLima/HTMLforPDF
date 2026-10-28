import { timingSafeEqual, createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { config } from '../config/env.js';

const hash = (value: string) => createHash('sha256').update(value).digest();

export const authenticate: RequestHandler = (req, res, next) => {
  if (config.apiKey.length < 32) {
    res.status(503).json({ error: 'API authentication is not configured' });

    return;
  }

  const supplied = req.get('X-API-Key') ?? '';

  if (!timingSafeEqual(hash(supplied), hash(config.apiKey))) {
    res.status(401).json({ error: 'Invalid API key' });

    return;
  }

  next();
};
