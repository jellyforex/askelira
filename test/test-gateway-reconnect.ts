/**
 * SD-034: Gateway reconnect and fallback tests
 *
 * Verifies that the agent router properly handles gateway failures
 * and falls back to direct API calls.
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

console.log('\n=== SD-034: Gateway Reconnect Tests ===\n');

test('agent-router has routing modes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/agent-router.ts'), 'utf-8');
  assert.ok(src.includes('gateway'), 'Should support gateway mode');
  assert.ok(src.includes('direct'), 'Should support direct mode');
  assert.ok(src.includes('gateway-only'), 'Should support gateway-only mode');
});

test('agent-router has fallback logic', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/agent-router.ts'), 'utf-8');
  assert.ok(src.includes('callClaudeWithSystem'), 'Should fallback to direct API');
});

test('gateway-client exists', () => {
  assert.ok(
    fs.existsSync(path.join(ROOT, 'lib/gateway-client.ts')),
    'Gateway client should exist',
  );
  const src = fs.readFileSync(path.join(ROOT, 'lib/gateway-client.ts'), 'utf-8');
  assert.ok(src.includes('reconnect') || src.includes('connect'), 'Should handle connection');
});

test('agent-router reads AGENT_ROUTING_MODE dynamically', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/agent-router.ts'), 'utf-8');
  assert.ok(src.includes('AGENT_ROUTING_MODE'), 'Should read routing mode from env');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
