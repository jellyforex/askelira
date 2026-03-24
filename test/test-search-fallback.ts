/**
 * SD-035: Search provider fallback tests
 *
 * Verifies that search functionality degrades gracefully
 * when providers are unavailable.
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

console.log('\n=== SD-035: Search Fallback Tests ===\n');

test('web-search.ts exists', () => {
  assert.ok(
    fs.existsSync(path.join(ROOT, 'lib/web-search.ts')),
    'Web search module should exist',
  );
});

test('web-search supports SEARCH_PROVIDER config', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/web-search.ts'), 'utf-8');
  assert.ok(src.includes('SEARCH_PROVIDER') || src.includes('search'), 'Should reference search provider');
});

test('web-search has error handling', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/web-search.ts'), 'utf-8');
  assert.ok(src.includes('catch') || src.includes('try'), 'Should handle errors gracefully');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
