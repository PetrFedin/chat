import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTestLog } from '../scripts/ci-test-evidence.mjs';

test('spec report retains exact totals and final failure, not request logs', () => {
  const result = summarizeTestLog('ℹ tests 3\nℹ pass 2\nℹ fail 1\nℹ skipped 0\n✖ failing tests:\ntest at test/page.test.js:4:1\nAssertionError: lost overlay\n');
  assert.deepEqual(result.counts, { tests: 3, pass: 2, fail: 1, skipped: 0 });
  assert.match(result.failureExcerpt, /lost overlay/);
  assert.equal(result.excerptTruncated, false);
});

test('TAP report captures diagnostics and totals without dropping failures', () => {
  const result = summarizeTestLog('TAP version 13\nnot ok 1 - page\n  ---\n  error: stale\n  ...\nok 2 - safe\n# tests 2\n# pass 1\n# fail 1\n');
  assert.equal(result.counts.fail, 1);
  assert.match(result.failureExcerpt, /error: stale/);
  assert.doesNotMatch(result.failureExcerpt, /ok 2 - safe/);
});

test('missing totals are not fabricated and failure evidence is bounded', () => {
  assert.deepEqual(summarizeTestLog('runner terminated').counts, {});
  const result = summarizeTestLog('failing tests:\n' + 'x'.repeat(40000));
  assert.equal(result.failureExcerpt.length, 32000);
  assert.equal(result.excerptTruncated, true);
});
