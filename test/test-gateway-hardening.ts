/**
 * Gateway Hardening — Static analysis tests
 *
 * Verifies that gateway hardening changes are present in the codebase.
 * Pattern: read source files and assert presence of key strings.
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

console.log('\n=== Gateway Hardening Tests ===\n');

const agentRouter = fs.readFileSync(path.join(ROOT, 'lib/agent-router.ts'), 'utf-8');
const buildingLoop = fs.readFileSync(path.join(ROOT, 'lib/building-loop.ts'), 'utf-8');
const stepRunner = fs.readFileSync(path.join(ROOT, 'lib/step-runner.ts'), 'utf-8');
const gatewayClient = fs.readFileSync(path.join(ROOT, 'lib/gateway-client.ts'), 'utf-8');
const buildCmd = fs.readFileSync(path.join(ROOT, 'cli/commands/build.ts'), 'utf-8');
const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf-8');

test('1. agent-router exports ensureGatewayReady', () => {
  assert.ok(agentRouter.includes('export async function ensureGatewayReady'), 'Should export ensureGatewayReady');
});

test('2. building-loop calls ensureGatewayReady', () => {
  assert.ok(buildingLoop.includes('ensureGatewayReady'), 'Should call ensureGatewayReady');
});

test('3. step-runner calls ensureGatewayReady', () => {
  assert.ok(stepRunner.includes('ensureGatewayReady'), 'Should call ensureGatewayReady');
});

test('4. gateway-client has PONG_TIMEOUT_MS constant', () => {
  assert.ok(gatewayClient.includes('PONG_TIMEOUT_MS'), 'Should have PONG_TIMEOUT_MS');
});

test('5. gateway-client has pongTimeoutTimer field', () => {
  assert.ok(gatewayClient.includes('pongTimeoutTimer'), 'Should have pongTimeoutTimer');
});

test('6. gateway-client has "Pong not received" log', () => {
  assert.ok(gatewayClient.includes('Pong not received'), 'Should log pong timeout');
});

test('7. gateway-client default heartbeat is 15000', () => {
  assert.ok(gatewayClient.includes('heartbeatIntervalMs ?? 15000'), 'Default heartbeat should be 15000ms');
});

test('8. gateway-client has previousSessionId tracking', () => {
  assert.ok(gatewayClient.includes('previousSessionId'), 'Should track previous session ID');
});

test('9. gateway-client has isSessionActive method', () => {
  assert.ok(gatewayClient.includes('isSessionActive'), 'Should have isSessionActive method');
});

test('10. gateway-client boot notification says "AskElira online"', () => {
  assert.ok(gatewayClient.includes('AskElira online'), 'Boot notification should say AskElira online');
});

test('11. build.ts imports testGatewayConnection', () => {
  assert.ok(buildCmd.includes('testGatewayConnection'), 'Should import testGatewayConnection');
});

test('12. build.ts prints "Gateway not connected"', () => {
  assert.ok(buildCmd.includes('Gateway not connected'), 'Should print gateway not connected error');
});

test('13. .env.example defaults to gateway-only', () => {
  assert.ok(envExample.includes('AGENT_ROUTING_MODE=gateway-only'), 'Should default to gateway-only');
});

// Phase 3 hardening fixes
test('14. gateway-client resets shouldReconnect on connect()', () => {
  assert.ok(gatewayClient.includes('this.shouldReconnect = true'), 'connect() should reset shouldReconnect');
});

test('15. gateway-client resets shuttingDown on connect()', () => {
  assert.ok(gatewayClient.includes('this.shuttingDown = false'), 'connect() should reset shuttingDown');
});

test('16. step-runner retry delay is 5s (not 30s)', () => {
  assert.ok(stepRunner.includes('Retrying in 5s'), 'Retry delay should be 5s for Vercel Hobby');
  assert.ok(!stepRunner.includes('Retrying in 30s'), 'Should not have 30s retry delay');
});

test('17. step-runner Elira step checks timeout', () => {
  // Elira step should check timeout like all other steps
  const start = stepRunner.indexOf('function runEliraStep');
  const end = stepRunner.indexOf('function runFinalizeStep');
  assert.ok(start > 0 && end > start, 'Should find runEliraStep and runFinalizeStep');
  const eliraBlock = stepRunner.slice(start, end);
  assert.ok(eliraBlock.includes('checkTimeout'), 'runEliraStep should call checkTimeout');
});

test('18. building-loop uses claude-opus-4-6 (not deprecated model)', () => {
  assert.ok(buildingLoop.includes("model: 'claude-opus-4-6'"), 'Should use claude-opus-4-6');
  assert.ok(!buildingLoop.includes("model: 'claude-opus-4-5'"), 'Should not use deprecated claude-opus-4-5');
});

test('19. building-loop releases goal lock before recursive runFloor', () => {
  const releaseBeforeRecursive = buildingLoop.indexOf('releaseGoalLock(floor.goalId)');
  const recursiveCall = buildingLoop.indexOf('await runFloor(nextFloor.id');
  assert.ok(releaseBeforeRecursive < recursiveCall, 'Goal lock should be released before recursive runFloor call');
});

test('20. building-loop has try/finally around main loop for lock safety', () => {
  assert.ok(buildingLoop.includes('} finally {'), 'Should have finally block for goal lock release');
});

test('21. agent-router exports resetRoutingMetrics', () => {
  assert.ok(agentRouter.includes('export function resetRoutingMetrics'), 'Should export resetRoutingMetrics');
});

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
