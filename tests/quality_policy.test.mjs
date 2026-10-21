import assert from 'node:assert/strict';
import test from 'node:test';
import { testPolicyError } from '../scripts/test-policy.mjs';
const baseline = { minimumFrontendCases: 43, minimumBackendCases: 59 };
const nodeSummary = (tests, pass, skipped = 0, cancelled = 0) =>
  `# tests ${tests}\n# pass ${pass}\n# skipped ${skipped}\n# cancelled ${cancelled}\n`;

test('a complete passing run can satisfy the gate even when new tests are added', () => {
  assert.equal(testPolicyError('frontend', nodeSummary(48, 48), baseline), null);
  assert.equal(testPolicyError('backend', '59 passed, 2 warnings in 4.03s\n', baseline), null);
});
test('success exit code with omitted or empty tests cannot satisfy the gate', () => {
  assert.ok(testPolicyError('frontend', nodeSummary(0, 0), baseline));
  assert.ok(testPolicyError('backend', '58 passed in 1s\n', baseline));
});
test('a skipped, cancelled or non-passing frontend run is rejected', () => {
  assert.ok(testPolicyError('frontend', nodeSummary(44, 43, 1), baseline));
  assert.ok(testPolicyError('frontend', nodeSummary(44, 43, 0, 1), baseline));
  assert.ok(testPolicyError('frontend', nodeSummary(43, 42), baseline));
});
test('pytest skips, expected failures and deselection cannot hide regressions', () => {
  for (const marker of ['skipped', 'xfailed', 'xpassed', 'deselected']) {
    assert.ok(testPolicyError('backend', `59 passed, 1 ${marker} in 1s\n`, baseline));
  }
});
test('truncated or absent summaries remain unverified', () => {
  assert.ok(testPolicyError('frontend', '# tests 43\n', baseline));
  assert.ok(testPolicyError('backend', 'tests started...\n', baseline));
});
