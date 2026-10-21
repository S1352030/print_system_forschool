import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, python, run, isolatedEnv } from './quality-lib.mjs';
isolatedEnv();
const base = mkdtempSync(resolve(root, '.quality-reports', 'tmp', 'pytest-'));
process.exitCode = run(python, ['-m', 'pytest', '-q', 'tests', '-p', 'no:cacheprovider', `--basetemp=${resolve(base, 'cases')}`]);
