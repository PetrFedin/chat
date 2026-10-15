import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// CI diagnostic evidence only; callers must preserve the original test exit code.
export function summarizeTestLog(input) {
  const clean = String(input).replace(/\x1b\[[0-9;]*m/g, '');
  const lines = clean.split(/\r?\n/);
  const counts = {};
  for (const line of lines) {
    const match = line.match(/^\s*(?:#|\u2139)\s+(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/);
    if (match) counts[match[1]] = Number(match[2]);
  }
  const marker = lines.findLastIndex(line => /failing tests:\s*$/.test(line));
  let failures;
  if (marker >= 0) {
    failures = lines.slice(marker + 1).filter(line => !/^\s*\{.*"(?:ts|lvl|ev)"/.test(line));
  } else {
    failures = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*not ok \d+\b/.test(lines[i])) continue;
      failures.push(lines[i]);
      for (let j = i + 1; j < Math.min(i + 65, lines.length); j++) {
        if (/^\s*(?:ok|not ok) \d+\b|^\s*# Subtest:/.test(lines[j])) break;
        if (!/^\s*#\s*\{/.test(lines[j])) failures.push(lines[j]);
      }
    }
  }
  const text = failures.join('\n');
  return { counts, failureExcerpt: text.slice(0, 32000), excerptTruncated: text.length > 32000 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , source, destination] = process.argv;
  if (!source || !destination) throw new Error('Usage: node scripts/ci-test-evidence.mjs LOG OUTPUT_JSON');
  const result = {
    schemaVersion: 1,
    testedSha: process.env.TESTED_SHA || null,
    proposedHeadSha: process.env.PROPOSED_HEAD_SHA || null,
    runId: process.env.GITHUB_RUN_ID || null,
    job: process.env.GITHUB_JOB || null,
    testExitCode: Number(process.env.TEST_EXIT_CODE ?? -1),
    ...summarizeTestLog(readFileSync(source, 'utf8')),
  };
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
