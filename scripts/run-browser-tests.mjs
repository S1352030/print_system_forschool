import { existsSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import { run } from './quality-lib.mjs';

// The quality gate requires its pinned browser; no silent fallback or skip.
if (!existsSync(chromium.executablePath())) {
  console.error('Chromium is missing. Run: npx playwright install chromium');
  process.exitCode = 1;
} else if (process.env.REQUIRE_WEBKIT === '1' && !existsSync(webkit.executablePath())) {
  console.error('Required WebKit is missing. Run: npx playwright install webkit');
  process.exitCode = 1;
} else {
  for (const file of ['browser_service_worker_smoke.mjs', 'browser_preview_smoke.mjs', 'browser_gift_cards_smoke.mjs']) {
    const code = run(process.execPath, [`tests/${file}`], { timeout: 180_000 });
    if (code !== 0) { process.exitCode = code; break; }
  }
  if (!existsSync(webkit.executablePath())) console.warn('WebKit not installed: Safari validation remains incomplete.');
}
