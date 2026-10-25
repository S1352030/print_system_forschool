import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { run, isolatedEnv } from './quality-lib.mjs';

// Chromium's SingletonSocket lives under TMPDIR, and Unix socket paths are capped near
// 108 bytes; deep CI checkouts overflow it. POSIX browsers get a short private temp dir.
const shortTemp = process.platform === 'win32' ? null : mkdtempSync('/tmp/psqa-');
const env = shortTemp ? { ...isolatedEnv(), TMP: shortTemp, TEMP: shortTemp, TMPDIR: shortTemp } : undefined;

// The quality gate requires its pinned browser; no silent fallback or skip.
if (!existsSync(chromium.executablePath())) {
  console.error('Chromium is missing. Run: npx playwright install chromium');
  process.exitCode = 1;
} else if (process.env.REQUIRE_WEBKIT === '1' && !existsSync(webkit.executablePath())) {
  console.error('Required WebKit is missing. Run: npx playwright install webkit');
  process.exitCode = 1;
} else {
  for (const file of ['browser_service_worker_smoke.mjs', 'browser_preview_smoke.mjs', 'browser_gift_cards_smoke.mjs']) {
    const code = run(process.execPath, [`tests/${file}`], { timeout: 180_000, ...(env && { env }) });
    if (code !== 0) { process.exitCode = code; break; }
  }
  if (!existsSync(webkit.executablePath())) console.warn('WebKit not installed: Safari validation remains incomplete.');
}
if (shortTemp) rmSync(shortTemp, { recursive: true, force: true });
