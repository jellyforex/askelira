/**
 * SD-036: Auth middleware tests
 *
 * Verifies that all protected API routes properly check authentication
 * and return 401 for unauthorized requests.
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

console.log('\n=== SD-036: Auth Middleware Tests ===\n');

const PROTECTED_ROUTES = [
  'app/api/goals/new/route.ts',
  'app/api/usage/route.ts',
  'app/api/debates/route.ts',
  'app/api/workspace/route.ts',
  'app/api/billing/checkout/route.ts',
  'app/api/user/export/route.ts',
];

// goals/route.ts returns empty array for unauth (not 401) — this is by design
test('app/api/goals/route.ts requires session for data', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/api/goals/route.ts'), 'utf-8');
  assert.ok(src.includes('getServerSession'), 'Should check session');
  assert.ok(src.includes('session?.user?.email'), 'Should check user email');
});

for (const route of PROTECTED_ROUTES) {
  test(`${route} requires auth`, () => {
    const filepath = path.join(ROOT, route);
    assert.ok(fs.existsSync(filepath), `Route ${route} should exist`);
    const src = fs.readFileSync(filepath, 'utf-8');
    assert.ok(
      src.includes('getServerSession') || src.includes('CRON_SECRET'),
      `${route} should check authentication`,
    );
    assert.ok(
      src.includes('401') || src.includes('Unauthorized'),
      `${route} should return 401 for unauthorized requests`,
    );
  });
}

test('middleware.ts has global rate limiting', () => {
  const src = fs.readFileSync(path.join(ROOT, 'middleware.ts'), 'utf-8');
  assert.ok(src.includes('429'), 'Should return 429 for rate-limited requests');
  assert.ok(src.includes('X-RateLimit'), 'Should set rate limit headers');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
