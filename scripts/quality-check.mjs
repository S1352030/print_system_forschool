import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { root, python, isolatedEnv } from './quality-lib.mjs';
import { testPolicyError } from './test-policy.mjs';

const fast = process.argv.includes('--fast');
const [major, minor] = process.versions.node.split('.').map(Number);
const outputDir = resolve(root, '.quality-reports');
mkdirSync(outputDir, { recursive: true });
const id = `qa-${Date.now()}-${randomUUID().slice(0, 8)}`;
const buildDir = resolve(root, 'static', 'builds', id);
const env = { ...isolatedEnv(), APP_BUILD_ID: id, BACKEND_BUILD_ID: '', BUILD_ID: '', BUILD_OUTPUT_DIR: buildDir, QA_BROWSER_BUILD_ID: id };
const testBaseline = JSON.parse(readFileSync(resolve(root, 'quality/test-baseline.json'), 'utf8'));
const git = (args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
};
function sourceFingerprint() {
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (files === null) return null;
  const digest = createHash('sha256');
  for (const file of [...new Set(files.split('\0').filter(Boolean))].sort()) {
    const path = resolve(root, file);
    digest.update(file).update('\0');
    digest.update(existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'deleted');
    digest.update('\0');
  }
  return digest.digest('hex');
}
const report = {
  startedAt: new Date().toISOString(), mode: fast ? 'fast' : 'full',
  revision: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']),
  workingTree: git(['status', '--porcelain']), node: process.version, python,
  buildId: id, checks: [], status: 'running',
  sourceFingerprint: sourceFingerprint(),
  limitations: ['No production deployment, real-device test, external LINE delivery or disaster recovery drill.'],
};
function step(name, command, args, required = true, timeout = 300_000) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 20 * 1024 * 1024 });
  const log = `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n${result.error.message}` : ''}`;
  writeFileSync(resolve(outputDir, `${id}-${name}.log`), log);
  let status = result.error ? 'blocked' : result.status === 0 ? 'passed' : 'failed';
  const policyError = status === 'passed' ? testPolicyError(name, log, testBaseline) : null;
  if (policyError) { status = 'failed'; console.error(policyError); }
  const check = { name, required, status, exitCode: result.status, durationMs: Date.now() - started, log: `${id}-${name}.log` };
  if (policyError) check.message = policyError;
  report.checks.push(check);
  console.log(`${name}: ${status}`);
  if (status !== 'passed') console.error(log.slice(-6000));
  if (name === 'browser' && /WebKit.*(?:skipped|not installed)/i.test(log)) report.limitations.push('WebKit was skipped; Safari not validated.');
  return status === 'passed';
}
if (major !== 22 || minor < 12) {
  report.checks.push({ name: 'runtime', required: true, status: 'blocked', message: 'Use Node 22 LTS >=22.12 (.nvmrc: 22.23.2).' });
} else {
  step('syntax', process.execPath, ['scripts/check-source.mjs']);
  step('architecture-js', process.execPath, ['node_modules/dependency-cruiser/bin/dependency-cruiser.mjs', '--config', '.dependency-cruiser.cjs', 'static/js', 'static/dialog.js']);
  step('architecture-python', python, ['scripts/check_python.py', '--architecture']);
  step('specs', process.execPath, ['node_modules/@fission-ai/openspec/bin/openspec.js', 'validate', '--all', '--strict', '--no-interactive']);
  step('specs-archived', process.execPath, ['node_modules/@fission-ai/openspec/bin/openspec.js', 'validate', '--archived', '--strict', '--no-interactive']);
  step('governance', process.execPath, ['scripts/check-governance.mjs']);
  step('frontend', process.execPath, ['--test', 'tests/*.test.mjs']);
  step('backend', process.execPath, ['scripts/run-backend-tests.mjs']);
  const built = step('build', process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
  if (built) {
    // Compress only this new QA release, without cleaning or rewriting other releases.
    const compressed = step('precompress', python, ['scripts/compress_qa_build.py', buildDir]);
    if (compressed) step('verify-build', process.execPath, ['scripts/verify-build.mjs']);
    else report.checks.push({ name: 'verify-build', required: true, status: 'blocked', message: 'Precompression failed.' });
  } else report.checks.push({ name: 'verify-build', required: true, status: 'blocked', message: 'Build failed.' });
  if (fast) report.checks.push({ name: 'browser', required: true, status: 'not-run', message: 'Fast mode; full regression gate is incomplete.' });
  else step('browser', process.execPath, ['scripts/run-browser-tests.mjs']);
}
report.finishedAt = new Date().toISOString();
report.finalSourceFingerprint = sourceFingerprint();
if (report.sourceFingerprint === null || report.sourceFingerprint !== report.finalSourceFingerprint) {
  report.checks.push({ name: 'source-consistency', required: true, status: 'failed', message: 'Git unavailable or source changed during verification; rerun on the final source.' });
}
report.status = report.checks.some((c) => ['failed', 'blocked'].includes(c.status)) ? 'failed'
  : report.checks.some((c) => c.required && c.status === 'not-run') ? 'partial' : 'passed';
writeFileSync(resolve(outputDir, `${id}.json`), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(outputDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);
const rows = report.checks.map((c) => `| ${c.name} | ${c.status} | ${c.exitCode ?? ''} |`).join('\n');
writeFileSync(resolve(outputDir, 'latest.md'), `# 品質檢查報告\n\n- 版本：${report.revision}\n- 分支：${report.branch}\n- 結果：${report.status}\n- 工作目錄：${report.workingTree ? '含未提交變更' : '乾淨'}\n- 建置：${id}\n\n| 檢查 | 結果 | 退出碼 |\n| --- | --- | --- |\n${rows}\n\n${report.limitations.map((s) => `- ${s}`).join('\n')}\n`);
console.log(`Quality result: ${report.status}; report: .quality-reports/latest.md`);
// Partial runs must never satisfy the stable release gate.
process.exitCode = report.status === 'passed' ? 0 : 1;
