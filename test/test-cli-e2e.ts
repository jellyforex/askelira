/**
 * SD-040: CLI end-to-end tests
 *
 * Verifies CLI entry points exist and have proper structure.
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

console.log('\n=== SD-040: CLI End-to-End Tests ===\n');

test('CLI entry point exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  assert.ok(pkg.bin.askelira, 'Should have askelira bin');
  assert.ok(
    fs.existsSync(path.join(ROOT, pkg.bin.askelira)),
    'CLI entry file should exist',
  );
});

test('enhanced CLI exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  assert.ok(pkg.bin.ask, 'Should have ask bin');
  assert.ok(
    fs.existsSync(path.join(ROOT, pkg.bin.ask)),
    'Enhanced CLI file should exist',
  );
});

test('TUI dashboard exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  assert.ok(pkg.bin['askelira-tui'], 'Should have TUI bin');
  assert.ok(
    fs.existsSync(path.join(ROOT, pkg.bin['askelira-tui'])),
    'TUI dashboard file should exist',
  );
});

test('package.json has all required scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const requiredScripts = ['start', 'dev', 'build', 'test', 'lint', 'deploy', 'db:migrate', 'db:validate'];
  for (const script of requiredScripts) {
    assert.ok(pkg.scripts[script], `Should have '${script}' script`);
  }
});

test('package.json has security scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  assert.ok(pkg.scripts['security:audit'], 'Should have security:audit');
  assert.ok(pkg.scripts['security:scan'], 'Should have security:scan');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
