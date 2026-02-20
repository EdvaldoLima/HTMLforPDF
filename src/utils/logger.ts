const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = typeof LEVELS[number];

function getLevelIndex(level: string): number {
  const idx = LEVELS.indexOf(level as Level);
  return idx === -1 ? LEVELS.indexOf('info') : idx;
}

const configured = (process.env.LOG_LEVEL || 'info').toLowerCase();
const configuredIndex = getLevelIndex(configured);

function formatMeta(meta?: any) {
  if (meta === undefined) return '';
  try {
    if (typeof meta === 'string') return ` ${meta}`;
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' [unserializable-meta]';
  }
}

function log(level: Level, message: string, meta?: any) {
  if (getLevelIndex(level) < configuredIndex) return;
  const ts = new Date().toISOString();
  const out = `${ts} ${level.toUpperCase()} ${message}${formatMeta(meta)}`;
  // Use stderr for warn/error, stdout otherwise
  if (level === 'error' || level === 'warn') {
    console.error(out);
  } else {
    console.log(out);
  }
}

const logger = {
  debug: (msg: string, meta?: any) => log('debug', msg, meta),
  info: (msg: string, meta?: any) => log('info', msg, meta),
  warn: (msg: string, meta?: any) => log('warn', msg, meta),
  error: (msg: string, meta?: any) => log('error', msg, meta),
};

export default logger;
