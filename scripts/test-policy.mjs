// Detect empty, skipped or truncated test runs before marking a quality gate green.
export function testPolicyError(name, output, baseline) {
  if (name === 'frontend') {
    const count = output.match(/^# tests (\d+)$/m)?.[1];
    const passed = output.match(/^# pass (\d+)$/m)?.[1];
    const skipped = output.match(/^# skipped (\d+)$/m)?.[1];
    const cancelled = output.match(/^# cancelled (\d+)$/m)?.[1];
    if (count === undefined || passed === undefined || skipped === undefined || cancelled === undefined) return 'Missing complete Node test summary.';
    if (Number(count) < baseline.minimumFrontendCases) return 'Frontend test count fell below the reviewed baseline.';
    if (Number(passed) !== Number(count) || Number(skipped) || Number(cancelled)) return 'Frontend tests were skipped, cancelled or did not all pass.';
  } else if (name === 'backend') {
    const passed = output.match(/(?:^|\n)(\d+) passed(?:,| in)/)?.[1];
    if (passed === undefined) return 'Missing complete pytest success summary.';
    if (Number(passed) < baseline.minimumBackendCases) return 'Backend test count fell below the reviewed baseline.';
    if (/\b[1-9]\d* (?:skipped|xfailed|xpassed|deselected)\b/.test(output)) return 'Backend tests were skipped, xfailed or deselected.';
  }
  return null;
}
