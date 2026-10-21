import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { root, python, run } from './quality-lib.mjs';

function walk(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((item) => {
    if (item.isSymbolicLink()) throw new Error(`Source symlinks require review: ${dir}/${item.name}`);
    const path = `${dir}/${item.name}`;
    return item.isDirectory() ? walk(path) : [path];
  });
}
const files = [...walk('static/js'), ...walk('scripts'), ...walk('tests'),
  'static/dialog.js', 'sw.js', 'vite.config.mjs', 'ecosystem.config.cjs', '.dependency-cruiser.cjs']
  .filter((file) => /\.(?:js|mjs|cjs)$/.test(file));
let failed = false;
const hashes = new Map();
for (const file of files) {
  if (run(process.execPath, ['--check', file]) !== 0) failed = true;
  if (!file.startsWith('static/')) continue;
  const hash = createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
  if (hashes.has(hash)) { console.error(`Duplicate module: ${hashes.get(hash)} and ${file}`); failed = true; }
  hashes.set(hash, file);
}
if (run(python, ['scripts/check_python.py', '--syntax']) !== 0) failed = true;
console.log(`Syntax checked: ${files.length} JavaScript files; Python parsed without importing the application.`);
process.exitCode = failed ? 1 : 0;
