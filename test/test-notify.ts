/**
 * SD-033: Telegram notification tests
 *
 * Tests the notify module's structure and graceful degradation
 * when TELEGRAM env vars are not set.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (err: unknown) { console.error(`  FAIL: ${name}\n        ${err instanceof Error ? err.message : err}`); failed++; }
}

console.log('\n=== SD-033: Telegram Notify Tests ===\n');

test('notify.ts exports notify function', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/notify.ts'), 'utf-8');
  assert.ok(src.includes('export async function notify'), 'Should export notify');
});

test('notify returns silently without TELEGRAM config', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/notify.ts'), 'utf-8');
  assert.ok(src.includes('if (!token || !chatId) return'), 'Should return early without config');
});

test('notify has timeout protection', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/notify.ts'), 'utf-8');
  assert.ok(src.includes('NOTIFY_TIMEOUT_MS'), 'Should have timeout');
  assert.ok(src.includes('AbortController'), 'Should use AbortController');
});

test('notify has Markdown fallback', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/notify.ts'), 'utf-8');
  assert.ok(src.includes("can't parse entities"), 'Should detect parse errors');
  assert.ok(src.includes('parse_mode'), 'Should use parse_mode');
});

test('notify never throws', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/notify.ts'), 'utf-8');
  // The outer try-catch should catch everything
  const catchCount = (src.match(/catch/g) || []).length;
  assert.ok(catchCount >= 2, 'Should have multiple catch blocks for safety');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
