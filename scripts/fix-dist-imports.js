#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

const DIST = path.resolve(process.cwd(), 'dist');

function needsExtension(p) {
  // ignore npm packages and absolute urls
  if (!p.startsWith('./') && !p.startsWith('../')) return false;
  // if already has extension, skip
  if (/\.[a-zA-Z0-9]+$/.test(p)) return false;
  return true;
}

async function processFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  const replaced = content.replace(
    /((?:import|export)\s[^'"`]*?from\s*['"])(\.\.?\/.+?)(['"])/g,
    (m, p1, p2, p3) => {
      if (needsExtension(p2)) return p1 + p2 + '.js' + p3;
      return m;
    },
  );
  if (replaced !== content) await fs.writeFile(filePath, replaced, 'utf8');
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (ent) => {
      const res = path.join(dir, ent.name);
      if (ent.isDirectory()) return walk(res);
      if (ent.isFile() && res.endsWith('.js')) return processFile(res);
    }),
  );
}

walk(DIST).catch((err) => {
  console.error('fix-dist-imports failed:', err);
  process.exit(1);
});
