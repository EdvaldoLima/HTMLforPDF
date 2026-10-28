import { config } from './config/env.js';
import app from './app.js';
import { closeConnection } from './queue/rabbitmq.js';
import { closeBrowsers } from './services/pdfService.js';
import logger from './utils/logger.js';

if (config.apiKey.length < 32) throw new Error('API_KEY must contain at least 32 characters');

const server = app.listen(config.port, () => logger.info('API listening', { port: config.port }));

server.requestTimeout = 60_000;
server.headersTimeout = 15_000;

let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;

  const deadline = setTimeout(() => process.exit(1), config.renderTimeout + 15_000);

  deadline.unref();

  server.close(() => {
    void Promise.allSettled([closeBrowsers(), closeConnection()]).then(() => process.exit(0));
  });

  server.closeIdleConnections();
}

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
