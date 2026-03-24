/**
 * SD-039: Database migration tests
 *
 * Verifies migration files are properly structured and numbered.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (err: unknown) { console.error(`  FAIL: ${name}\n        ${err instanceof Error ? err.message : err}`); failed++; }
}

console.log('\n=== SD-039: Migration Tests ===\n');

test('migrations directory exists', () => {
  assert.ok(fs.existsSync(MIGRATIONS_DIR), 'migrations/ should exist');
});

test('migration files are numbered sequentially', () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  assert.ok(files.length >= 1, 'Should have at least 1 migration');

  for (let i = 0; i < files.length; i++) {
    const expected = String(i + 1).padStart(3, '0');
    assert.ok(
      files[i].startsWith(`${expected}_`),
      `Migration ${files[i]} should start with ${expected}_`,
    );
  }
});

test('all migration files contain valid SQL', () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    assert.ok(content.length > 0, `${file} should not be empty`);
    // Check for at least one SQL keyword
    assert.ok(
      /CREATE|ALTER|INSERT|DROP|INDEX/i.test(content),
      `${file} should contain SQL statements`,
    );
  }
});

test('migration files are idempotent', () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    // All CREATE should use IF NOT EXISTS
    const createMatches = content.match(/CREATE\s+TABLE(?!\s+IF)/gi) || [];
    assert.strictEqual(
      createMatches.length, 0,
      `${file}: All CREATE TABLE should use IF NOT EXISTS`,
    );
    const indexMatches = content.match(/CREATE\s+INDEX(?!\s+IF)/gi) || [];
    assert.strictEqual(
      indexMatches.length, 0,
      `${file}: All CREATE INDEX should use IF NOT EXISTS`,
    );
  }
});

test('migrate-all.mjs reads from migrations/', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/migrate-all.mjs'), 'utf-8');
  assert.ok(src.includes('readdirSync'), 'Should read migration directory');
  assert.ok(src.includes('.sql'), 'Should filter SQL files');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
