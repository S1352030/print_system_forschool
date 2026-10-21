import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { root } from './quality-lib.mjs';

const errors = [];
for (const file of ['AGENTS.md', 'ARCHITECTURE.md', 'AI_CHANGELOG.md', 'docs/QUALITY.md',
  'docs/KNOWN_ISSUES.md', 'openspec/config.yaml', 'tests/fixtures/contracts.json', 'quality/test-baseline.json']) {
  if (!existsSync(resolve(root, file))) errors.push(`Missing project context: ${file}`);
}
if (existsSync(resolve(root, 'AI_CHANGELOG.md')) && !readFileSync(resolve(root, 'AI_CHANGELOG.md'), 'utf8').startsWith('# AI Changelog')) {
  errors.push('Keep the existing AI Changelog heading and history.');
}
function git(args, optional = false) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 && !optional) errors.push(`Git check failed: ${args.join(' ')}`);
  return result;
}
if (git(['check-ignore', '--no-index', 'AI_CHANGELOG.md'], true).status === 0) errors.push('AI_CHANGELOG.md must be visible to Git.');
const base = process.env.QUALITY_BASE_REF;
const changes = git(base ? ['diff', '--name-only', `${base}...HEAD`] : ['diff', '--name-only', 'HEAD', '--']).stdout || '';
const untracked = git(['ls-files', '--others', '--exclude-standard']).stdout || '';
const changed = new Set(`${changes}\n${untracked}`.trim().split(/\r?\n/).filter(Boolean));
const substantive = [...changed].some((path) => /^(static\/js\/|static\/dialog\.js|.*\.(?:py|html|css|mjs|cjs)$|package(?:-lock)?\.json$|requirements.*|deploy\.sh$|\.github\/)/.test(path));
if (substantive && !changed.has('AI_CHANGELOG.md')) errors.push('Source/config changed: append a record to the existing AI_CHANGELOG.md.');
for (const error of errors) console.error(error);
console.log(`Governance: ${changed.size} changed/untracked files checked. Documentation meaning and similar code still require review.`);
process.exitCode = errors.length ? 1 : 0;
