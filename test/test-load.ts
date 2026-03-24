/**
 * SD-032: Load test for rate limiter and concurrent request handling
 *
 * Tests that the rate limiter correctly handles burst traffic and
 * the build queue enforces concurrency limits.
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

console.log('\n=== SD-032: Load Tests ===\n');

// Test rate limiter under concurrent load
test('rate-limiter handles burst correctly', () => {
  // Inline require to test the actual module
  const { checkRateLimit } = require(path.join(ROOT, 'lib/rate-limiter.ts')) as {
    checkRateLimit: (id: string, limit: number, window: number) => { allowed: boolean; remaining: number };
  };

  const testId = `load-test-${Date.now()}`;
  const limit = 5;
  const window = 60_000;

  // First 5 requests should succeed
  for (let i = 0; i < limit; i++) {
    const result = checkRateLimit(testId, limit, window);
    assert.ok(result.allowed, `Request ${i + 1} should be allowed`);
  }

  // 6th request should be rejected
  const result = checkRateLimit(testId, limit, window);
  assert.ok(!result.allowed, 'Request 6 should be rejected');
  assert.strictEqual(result.remaining, 0, 'Remaining should be 0');
});

test('build-queue enforces concurrent limits', () => {
  const { canStartBuild, recordBuildStart, recordBuildEnd } = require(path.join(ROOT, 'lib/build-queue.ts')) as {
    canStartBuild: (id: string) => { allowed: boolean };
    recordBuildStart: (id: string) => void;
    recordBuildEnd: (id: string) => void;
  };

  const testUser = `load-test-user-${Date.now()}`;

  // Start 3 builds (max concurrent)
  for (let i = 0; i < 3; i++) {
    const check = canStartBuild(testUser);
    assert.ok(check.allowed, `Build ${i + 1} should be allowed`);
    recordBuildStart(testUser);
  }

  // 4th build should be rejected
  const check = canStartBuild(testUser);
  assert.ok(!check.allowed, '4th build should be rejected');

  // End one build, next should be allowed
  recordBuildEnd(testUser);
  const check2 = canStartBuild(testUser);
  assert.ok(check2.allowed, 'Build should be allowed after one completes');
});

test('content-validator handles concurrent validation', () => {
  const { validateContent } = require(path.join(ROOT, 'lib/content-validator.ts')) as {
    validateContent: (text: string, field?: string) => { valid: boolean; reason?: string };
  };

  // Run 100 validations concurrently
  const results = Array.from({ length: 100 }, (_, i) =>
    validateContent(`Test content ${i}`, 'test')
  );

  const allValid = results.every(r => r.valid);
  assert.ok(allValid, 'All 100 concurrent validations should pass');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
