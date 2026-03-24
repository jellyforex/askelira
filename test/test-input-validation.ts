/**
 * SD-038: Input validation tests
 *
 * Tests the content validator against various attack patterns.
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

console.log('\n=== SD-038: Input Validation Tests ===\n');

const { validateContent, validateGoalText } = require(path.join(ROOT, 'lib/content-validator.ts')) as {
  validateContent: (text: string, field?: string) => { valid: boolean; reason?: string };
  validateGoalText: (text: string) => { valid: boolean; reason?: string };
};

test('accepts valid text', () => {
  const result = validateContent('Build me a landing page for my SaaS product');
  assert.ok(result.valid, 'Normal text should be valid');
});

test('rejects script tags', () => {
  const result = validateContent('<script>alert("xss")</script>');
  assert.ok(!result.valid, 'Script tags should be rejected');
});

test('rejects javascript: protocol', () => {
  const result = validateContent('javascript:void(0)');
  assert.ok(!result.valid, 'javascript: should be rejected');
});

test('rejects SQL injection patterns', () => {
  const result = validateContent("'; DROP TABLE goals; --");
  assert.ok(!result.valid, 'SQL injection should be rejected');
});

test('rejects UNION SELECT', () => {
  const result = validateContent('UNION SELECT * FROM users');
  assert.ok(!result.valid, 'UNION SELECT should be rejected');
});

test('rejects null bytes', () => {
  const result = validateContent('hello\0world');
  assert.ok(!result.valid, 'Null bytes should be rejected');
});

test('rejects eval() attempts', () => {
  const result = validateContent('eval("malicious code")');
  assert.ok(!result.valid, 'eval() should be rejected');
});

test('validateGoalText rejects empty text', () => {
  const result = validateGoalText('');
  assert.ok(!result.valid, 'Empty goal text should be rejected');
});

test('validateGoalText rejects oversized text', () => {
  const result = validateGoalText('x'.repeat(5001));
  assert.ok(!result.valid, 'Oversized goal text should be rejected');
});

test('validateGoalText accepts valid goal', () => {
  const result = validateGoalText('Create an e-commerce checkout flow');
  assert.ok(result.valid, 'Valid goal text should be accepted');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
