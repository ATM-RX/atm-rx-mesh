#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '../dist/cli.js');

if (fs.existsSync(distPath)) {
  await import(distPath);
} else {
  // Fallback for development runtime
  const { register } = await import('tsx/esm/api');
  await import('../src/cli.ts');
}
