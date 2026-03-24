/**
 * SD-031: Integration test for the full building pipeline
 *
 * Verifies that the step-runner, building-manager, and agent pipeline
 * modules are properly structured and export the expected functions.
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

console.log('\n=== SD-031: Pipeline Integration Tests ===\n');

test('step-runner exports chainNextStep', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/step-runner.ts'), 'utf-8');
  assert.ok(src.includes('export async function chainNextStep'), 'Should export chainNextStep');
});

test('step-runner has agent pipeline (Alba, Vex, David, Elira)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/step-runner.ts'), 'utf-8');
  assert.ok(src.includes('Alba'), 'Should reference Alba');
  assert.ok(src.includes('Vex'), 'Should reference Vex');
  assert.ok(src.includes('David'), 'Should reference David');
  assert.ok(src.includes('Elira'), 'Should reference Elira');
});

test('building-manager exports CRUD functions', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/building-manager.ts'), 'utf-8');
  assert.ok(src.includes('export async function createGoal'), 'Should export createGoal');
  assert.ok(src.includes('export async function getGoal'), 'Should export getGoal');
  assert.ok(src.includes('export async function createFloor'), 'Should export createFloor');
  assert.ok(src.includes('export async function updateFloorStatus'), 'Should export updateFloorStatus');
  assert.ok(src.includes('export async function logAgentAction'), 'Should export logAgentAction');
});

test('building-manager has soft delete', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/building-manager.ts'), 'utf-8');
  assert.ok(src.includes('softDeleteGoal'), 'Should have soft delete');
  assert.ok(src.includes('deleted_at IS NULL'), 'Should filter deleted goals');
});

test('heartbeat exports start/stop/check', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/heartbeat.ts'), 'utf-8');
  assert.ok(src.includes('export function startHeartbeat'), 'Should export startHeartbeat');
  assert.ok(src.includes('export function stopHeartbeat'), 'Should export stopHeartbeat');
  assert.ok(src.includes('export async function checkFloor'), 'Should export checkFloor');
});

test('agent-router exports routeAgentCall', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/agent-router.ts'), 'utf-8');
  assert.ok(src.includes('export async function routeAgentCall'), 'Should export routeAgentCall');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
