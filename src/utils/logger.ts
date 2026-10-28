const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

type Level = (typeof LEVELS)[number];

const configuredLevel = LEVELS.indexOf((process.env.LOG_LEVEL || 'info').toLowerCase() as Level);
const configuredIndex = configuredLevel < 0 ? LEVELS.indexOf('info') : configuredLevel;
const secretKey = /authorization|cookie|password|secret|token|api.?key|url|body|raw/i;

export function sanitize(value: unknown, depth = 0): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (depth > 5) return '[truncated]';
  // Exception messages can contain credentials and source URLs.
  if (value instanceof Error) return { name: value.name };
  if (typeof value === 'string')
    return value
      .slice(0, 1000)
      .replace(/https?:\/\/[^\s"']+/gi, '[url]')
      .replace(/amqps?:\/\/[^\s"']+/gi, '[broker]');
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([key, item]) => [
          key,
          secretKey.test(key) ? '[redacted]' : sanitize(item, depth + 1),
        ]),
    );

  return value;
}

function log(level: Level, message: string, meta?: unknown) {
  if (LEVELS.indexOf(level) < configuredIndex) return;

  const output = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message: sanitize(message),
    meta: sanitize(meta),
  });

  if (level === 'error' || level === 'warn') console.error(output);
  else console.log(output);
}

const logger = {
  debug: (msg: string, meta?: unknown) => log('debug', msg, meta),
  info: (msg: string, meta?: unknown) => log('info', msg, meta),
  warn: (msg: string, meta?: unknown) => log('warn', msg, meta),
  error: (msg: string, meta?: unknown) => log('error', msg, meta),
};

export default logger;
