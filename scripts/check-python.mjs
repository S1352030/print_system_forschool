import { python, run } from './quality-lib.mjs';
process.exitCode = run(python, ['scripts/check_python.py', '--architecture']);
