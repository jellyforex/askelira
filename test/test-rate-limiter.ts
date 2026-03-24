/**
 * SD-037: Rate limiter unit tests
 *
 * Tests the in-memory sliding window rate limiter directly.
 */

import * as assert from 'assert';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (err: unknown) { console.error(`  FAIL: ${name}\n        ${err instanceof Error ? err.message : err}`); failed++; }
}

console.log('\n=== SD-037: Rate Limiter Tests ===\n');

// Direct module test
const { checkRateLimit, getClientIp } = require(path.join(ROOT, 'lib/rate-limiter.ts')) as {
  checkRateLimit: (id: string, limit: number, window: number) => { allowed: boolean; remaining: number };
  getClientIp: (headers: Headers) => string;
};

test('allows requests within limit', () => {
  const id = `test-allow-${Date.now()}`;
  const result = checkRateLimit(id, 10, 60000);
  assert.ok(result.allowed, 'Should be allowed');
  assert.strictEqual(result.remaining, 9, 'Should have 9 remaining');
});

test('blocks requests over limit', () => {
  const id = `test-block-${Date.now()}`;
  for (let i = 0; i < 3; i++) {
    checkRateLimit(id, 3, 60000);
  }
  const result = checkRateLimit(id, 3, 60000);
  assert.ok(!result.allowed, 'Should be blocked');
  assert.strictEqual(result.remaining, 0, 'Should have 0 remaining');
});

test('different identifiers are independent', () => {
  const id1 = `test-ind1-${Date.now()}`;
  const id2 = `test-ind2-${Date.now()}`;
  checkRateLimit(id1, 1, 60000);
  const result = checkRateLimit(id2, 1, 60000);
  assert.ok(result.allowed, 'Different identifier should be allowed');
});

test('remaining count decrements', () => {
  const id = `test-dec-${Date.now()}`;
  const r1 = checkRateLimit(id, 5, 60000);
  assert.strictEqual(r1.remaining, 4);
  const r2 = checkRateLimit(id, 5, 60000);
  assert.strictEqual(r2.remaining, 3);
  const r3 = checkRateLimit(id, 5, 60000);
  assert.strictEqual(r3.remaining, 2);
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
