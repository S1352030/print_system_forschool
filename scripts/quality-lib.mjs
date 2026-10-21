import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const python = process.env.TEST_PYTHON || 'python';
export function isolatedEnv() {
  const temp = resolve(root, '.quality-reports', 'tmp');
  mkdirSync(temp, { recursive: true });
  return { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp, PYTHONUTF8: '1',
    OPENSPEC_TELEMETRY: '0', LINE_CHANNEL_ACCESS_TOKEN: '', LINE_RECEIVER_ID: '' };
}
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root, env: isolatedEnv(), stdio: 'inherit', windowsHide: true, ...options,
  });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}
