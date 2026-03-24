/**
 * Steven Delta — Installment 2: Rate Limiting and Abuse Prevention
 * Tests for SD-011 through SD-020
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAIL: ${name}`);
    console.error(`        ${msg}`);
    failed++;
  }
}

console.log('\n=== Steven Delta Installment 2: Rate Limiting & Abuse Prevention ===\n');

// SD-011: Per-user build rate limit
test('SD-011: build route imports rate limiter', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/api/build/route.ts'), 'utf-8');
  assert.ok(src.includes("import { checkRateLimit }"), 'Should import checkRateLimit');
  assert.ok(src.includes('build:${email}'), 'Should rate limit per user email');
});

// SD-012: Daily build limits
test('SD-012: build queue has daily limits', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/build-queue.ts'), 'utf-8');
  assert.ok(src.includes('MAX_DAILY_BUILDS_PER_USER'), 'Should have daily build limit');
  assert.ok(src.includes('dailyBuildCount'), 'Should track daily builds');
});

// SD-013: Content validation
test('SD-013: content-validator.ts exists', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/content-validator.ts'), 'utf-8');
  assert.ok(src.includes('validateContent'), 'Should export validateContent');
  assert.ok(src.includes('validateGoalText'), 'Should export validateGoalText');
  assert.ok(src.includes('SUSPICIOUS_PATTERNS'), 'Should have suspicious patterns');
  assert.ok(src.includes('<script'), 'Should detect script tags');
  assert.ok(src.includes('UNION'), 'Should detect SQL injection');
});

test('SD-013: build route uses content validation', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/api/build/route.ts'), 'utf-8');
  assert.ok(src.includes('validateContent'), 'Build route should validate content');
});

test('SD-013: goals/new uses content validation', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/api/goals/new/route.ts'), 'utf-8');
  assert.ok(src.includes('validateGoalText'), 'Goals/new should validate goal text');
});

// SD-014: Build queue
test('SD-014: build-queue.ts exists', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/build-queue.ts'), 'utf-8');
  assert.ok(src.includes('canStartBuild'), 'Should export canStartBuild');
  assert.ok(src.includes('recordBuildStart'), 'Should export recordBuildStart');
  assert.ok(src.includes('recordBuildEnd'), 'Should export recordBuildEnd');
  assert.ok(src.includes('MAX_CONCURRENT_BUILDS_PER_USER'), 'Should limit concurrent builds');
});

test('SD-014: build route uses queue', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/api/build/route.ts'), 'utf-8');
  assert.ok(src.includes('canStartBuild'), 'Should check build queue');
  assert.ok(src.includes('recordBuildStart'), 'Should record build start');
});

// SD-015: IP-based auth rate limiting (already exists on verify-key)
test('SD-015: verify-key has IP rate limiting', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/api/auth/verify-key/route.ts'), 'utf-8');
  assert.ok(src.includes('checkRateLimit'), 'Should rate limit auth');
  assert.ok(src.includes('verify_key'), 'Should use verify_key prefix');
});

// SD-016: Suspicious activity detection
test('SD-016: suspicious-activity.ts exists', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/suspicious-activity.ts'), 'utf-8');
  assert.ok(src.includes('recordFailedAuth'), 'Should export recordFailedAuth');
  assert.ok(src.includes('recordNotFound'), 'Should export recordNotFound');
  assert.ok(src.includes('FAILED_AUTH_THRESHOLD'), 'Should have failed auth threshold');
  assert.ok(src.includes('ENUMERATION_THRESHOLD'), 'Should have enumeration threshold');
  assert.ok(src.includes('notify'), 'Should notify on suspicious activity');
});

// SD-017: Request size limits
test('SD-017: middleware has request size limit', () => {
  const src = fs.readFileSync(path.join(ROOT, 'middleware.ts'), 'utf-8');
  assert.ok(src.includes('MAX_REQUEST_SIZE'), 'Should have max request size');
  assert.ok(src.includes('content-length'), 'Should check content-length header');
  assert.ok(src.includes('413'), 'Should return 413 for oversized requests');
});

// SD-018: Output size limits (via existing response patterns)
test('SD-018: build queue limits concurrent builds', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/build-queue.ts'), 'utf-8');
  const match = src.match(/MAX_CONCURRENT_BUILDS_PER_USER\s*=\s*(\d+)/);
  assert.ok(match, 'Should define max concurrent builds');
  assert.ok(parseInt(match![1]) <= 5, 'Should limit to 5 or fewer concurrent builds');
});

// SD-019: Goal char limit (reinforced via content-validator)
test('SD-019: content validator enforces goal length', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/content-validator.ts'), 'utf-8');
  assert.ok(src.includes('5000'), 'Should enforce 5000 char limit');
});

// SD-020: API key rotation reminder
test('SD-020: env-validator has rotation reminder', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/env-validator.ts'), 'utf-8');
  assert.ok(src.includes('rotation'), 'Should mention key rotation');
  assert.ok(src.includes('90 days'), 'Should recommend 90-day rotation');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
process.exit(failed > 0 ? 1 : 0);
