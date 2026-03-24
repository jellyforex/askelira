/**
 * Steven Alpha -- Installment 2: Fix Verification Tests
 *
 * These tests verify each of the 10 bug fixes applied in installment 2.
 * Run: node test/steven-alpha-fixes-2.test.js
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

const LIB = path.join(__dirname, '..', 'lib');
const APP = path.join(__dirname, '..', 'app');

console.log('Steven Alpha -- Installment 2: Fix Verification Tests\n');

// ============================================================
// FIX-2-01: braveSearch() has AbortController timeout
// ============================================================
console.log('BUG-2-01: braveSearch missing fetch timeout');
test('braveSearch creates AbortController with timeout', () => {
  const src = fs.readFileSync(path.join(LIB, 'tools', 'brave-search.ts'), 'utf-8');
  assert(src.includes('new AbortController()'), 'Missing AbortController creation');
  assert(src.includes('signal: controller.signal'), 'Missing signal on fetch call');
  assert(src.includes('clearTimeout(timeoutId)'), 'Missing clearTimeout after fetch');
  // Verify timeout is reasonable (10-30s)
  // Note: numeric separators like 15_000 require matching underscores in the regex
  const timeoutMatch = src.match(/setTimeout\(\(\) => controller\.abort\(\),\s*([\d_]+)/);
  assert(timeoutMatch, 'Missing setTimeout for abort');
  const timeoutMs = parseInt(timeoutMatch[1].replace(/_/g, ''), 10);
  assert(timeoutMs >= 10000 && timeoutMs <= 30000, `Timeout ${timeoutMs}ms not in 10-30s range`);
});

test('braveSearch timeout is 15 seconds', () => {
  const src = fs.readFileSync(path.join(LIB, 'tools', 'brave-search.ts'), 'utf-8');
  assert(src.includes('15_000'), 'Expected 15_000ms timeout');
});

// ============================================================
// FIX-2-02: addFloorToSubscription Stripe quantity fixed
// ============================================================
console.log('\nBUG-2-02: addFloorToSubscription Stripe quantity off-by-one');
test('quantity uses sub.floorsActive without +1', () => {
  const src = fs.readFileSync(path.join(LIB, 'subscription-manager.ts'), 'utf-8');
  // Find the quantity line in addFloorToSubscription
  const quantityMatch = src.match(/quantity:\s*sub\.floorsActive\b/);
  assert(quantityMatch, 'Expected quantity: sub.floorsActive (without +1)');
  // Verify the old +1 is gone
  assert(!src.includes('sub.floorsActive + 1'), 'Old off-by-one sub.floorsActive + 1 still present');
});

test('comment explains DB was already incremented', () => {
  const src = fs.readFileSync(path.join(LIB, 'subscription-manager.ts'), 'utf-8');
  assert(src.includes('already incremented'), 'Expected comment about DB already incremented');
});

// ============================================================
// FIX-2-03: swarm-cache periodic cleanup
// ============================================================
console.log('\nBUG-2-03: swarm-cache missing periodic cleanup');
test('swarm-cache has ensureCleanup function', () => {
  const src = fs.readFileSync(path.join(LIB, 'swarm-cache.ts'), 'utf-8');
  assert(src.includes('function ensureCleanup'), 'Missing ensureCleanup function');
  assert(src.includes('setInterval'), 'Missing setInterval for periodic cleanup');
});

test('swarm-cache cleanup removes expired entries', () => {
  const src = fs.readFileSync(path.join(LIB, 'swarm-cache.ts'), 'utf-8');
  // Verify it checks expiresAt
  assert(src.includes('entry.expiresAt'), 'Cleanup does not check expiresAt');
  assert(src.includes('cache.delete(key)'), 'Cleanup does not delete expired entries');
});

test('swarm-cache cleanup timer is unref-ed', () => {
  const src = fs.readFileSync(path.join(LIB, 'swarm-cache.ts'), 'utf-8');
  assert(src.includes('.unref()'), 'Cleanup timer not unref-ed');
});

test('cacheSet calls ensureCleanup', () => {
  const src = fs.readFileSync(path.join(LIB, 'swarm-cache.ts'), 'utf-8');
  // Find cacheSet function and verify it calls ensureCleanup
  const cacheSetIdx = src.indexOf('export function cacheSet');
  assert(cacheSetIdx >= 0, 'cacheSet not found');
  const cacheSetBody = src.slice(cacheSetIdx, cacheSetIdx + 200);
  assert(cacheSetBody.includes('ensureCleanup()'), 'cacheSet does not call ensureCleanup');
});

// ============================================================
// FIX-2-04: snapshots route has auth
// ============================================================
console.log('\nBUG-2-04: snapshots route missing authentication');
test('snapshots route imports getServerSession', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api', 'floors', '[floorId]', 'snapshots', 'route.ts'),
    'utf-8',
  );
  assert(src.includes("getServerSession"), 'Missing getServerSession import');
  assert(src.includes("authOptions"), 'Missing authOptions import');
});

test('snapshots route checks session before processing', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api', 'floors', '[floorId]', 'snapshots', 'route.ts'),
    'utf-8',
  );
  assert(src.includes("session?.user?.email"), 'Missing session email check');
  assert(src.includes("status: 401"), 'Missing 401 unauthorized response');
});

// ============================================================
// FIX-2-05: expand route has rate limiting
// ============================================================
console.log('\nBUG-2-05: expand route missing rate limiting');
test('expand route imports checkRateLimit', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api', 'goals', '[id]', 'expand', 'route.ts'),
    'utf-8',
  );
  assert(src.includes("checkRateLimit"), 'Missing checkRateLimit import');
  assert(src.includes("getClientIp"), 'Missing getClientIp import');
});

test('expand route enforces rate limit', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api', 'goals', '[id]', 'expand', 'route.ts'),
    'utf-8',
  );
  // Verify rate limit check exists
  const rateLimitMatch = src.match(/checkRateLimit\(`expand:\$\{ip\}`,\s*(\d+),\s*(\d+)\)/);
  assert(rateLimitMatch, 'Missing checkRateLimit call with expand prefix');
  const limit = parseInt(rateLimitMatch[1], 10);
  const windowMs = parseInt(rateLimitMatch[2], 10);
  assert(limit <= 10, `Rate limit ${limit} is too high (should be <=10)`);
  assert(windowMs === 3600000, `Window ${windowMs} is not 1 hour`);
  // Verify 429 response
  assert(src.includes('status: 429'), 'Missing 429 rate limit response');
});

// ============================================================
// FIX-2-06: logs route returns 503 on DB error
// ============================================================
console.log('\nBUG-2-06: logs route masks DB errors as empty 200');
test('logs route returns 503 on DB error', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api', 'goals', '[id]', 'logs', 'route.ts'),
    'utf-8',
  );
  // Find the DB error catch block
  const catchIdx = src.indexOf('DB error:');
  assert(catchIdx >= 0, 'Could not find DB error logging');
  const afterCatch = src.slice(catchIdx, catchIdx + 300);
  assert(afterCatch.includes('status: 503'), 'Missing 503 status in DB error handler');
  assert(afterCatch.includes('Database unavailable'), 'Missing "Database unavailable" error message');
});

test('logs route does NOT return bare 200 for DB errors', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api', 'goals', '[id]', 'logs', 'route.ts'),
    'utf-8',
  );
  // The old bug was: return NextResponse.json({ logs: [] }) with no status
  // in the DB error catch block. Verify that pattern is gone.
  const catchIdx = src.indexOf('DB error:');
  const afterCatch = src.slice(catchIdx, catchIdx + 300);
  // Should NOT have a bare NextResponse.json({ logs: [] }) without status
  const hasBareLogs = afterCatch.match(/NextResponse\.json\(\s*\{\s*logs:\s*\[\]\s*\}\s*\)/);
  assert(!hasBareLogs, 'DB error catch still returns bare { logs: [] } without error status');
});

// ============================================================
// FIX-2-07: chainNextStep has fetch timeout
// ============================================================
console.log('\nBUG-2-07: chainNextStep missing fetch timeout');
test('chainNextStep creates AbortController', () => {
  const src = fs.readFileSync(path.join(LIB, 'step-runner.ts'), 'utf-8');
  // Find chainNextStep function
  const fnIdx = src.indexOf('export async function chainNextStep');
  assert(fnIdx >= 0, 'chainNextStep not found');
  const fnBody = src.slice(fnIdx, fnIdx + 800);
  assert(fnBody.includes('new AbortController()'), 'Missing AbortController in chainNextStep');
  assert(fnBody.includes('signal: controller.signal'), 'Missing signal on fetch');
  assert(fnBody.includes('clearTimeout'), 'Missing clearTimeout after fetch');
});

test('chainNextStep handles AbortError gracefully', () => {
  const src = fs.readFileSync(path.join(LIB, 'step-runner.ts'), 'utf-8');
  const fnIdx = src.indexOf('export async function chainNextStep');
  // The function is ~37 lines; AbortError handling is near the end of the catch block
  const fnBody = src.slice(fnIdx, fnIdx + 1200);
  assert(fnBody.includes('AbortError'), 'Missing AbortError handling');
});

// ============================================================
// FIX-2-08: stall recovery has cooldown
// ============================================================
console.log('\nBUG-2-08: stall recovery restart storm');
test('heartbeat has stall recovery cooldown constant', () => {
  const src = fs.readFileSync(path.join(LIB, 'heartbeat.ts'), 'utf-8');
  assert(src.includes('STALL_COOLDOWN_MS'), 'Missing STALL_COOLDOWN_MS constant');
  // STALL_COOLDOWN_MS may be an expression like "10 * 60 * 1000" or a literal like "600000"
  const match = src.match(/STALL_COOLDOWN_MS\s*=\s*([^;]+);/);
  assert(match, 'Could not parse STALL_COOLDOWN_MS value');
  // Evaluate the expression safely (only allows digits, spaces, *, and _)
  const expr = match[1].trim().replace(/_/g, '').replace(/\/\/.*/, '').trim();
  assert(/^[\d\s*]+$/.test(expr), `STALL_COOLDOWN_MS expression "${expr}" contains unexpected characters`);
  const cooldownMs = Function(`return ${expr}`)();
  assert(cooldownMs >= 300000, `Cooldown ${cooldownMs}ms is too short (should be >=5min)`);
});

test('heartbeat has stallRecoveryTimestamps Map', () => {
  const src = fs.readFileSync(path.join(LIB, 'heartbeat.ts'), 'utf-8');
  assert(src.includes('stallRecoveryTimestamps'), 'Missing stallRecoveryTimestamps');
  assert(src.includes('new Map<string, number>'), 'stallRecoveryTimestamps is not a Map<string, number>');
});

test('checkStalledFloors checks cooldown before restarting', () => {
  const src = fs.readFileSync(path.join(LIB, 'heartbeat.ts'), 'utf-8');
  // Find checkStalledFloors
  const fnIdx = src.indexOf('async function checkStalledFloors');
  assert(fnIdx >= 0, 'checkStalledFloors not found');
  // Function is ~2900 chars; fetchWithRetry is at ~offset 2412
  const fnBody = src.slice(fnIdx, fnIdx + 3000);
  // Verify it reads the last restart timestamp
  assert(fnBody.includes('stallRecoveryTimestamps.get(floor.id)'), 'Missing cooldown timestamp read');
  // Verify it sets the timestamp before restarting
  assert(fnBody.includes('stallRecoveryTimestamps.set(floor.id'), 'Missing cooldown timestamp write');
  // Verify the set happens BEFORE the restart fetch
  const setIdx = fnBody.indexOf('stallRecoveryTimestamps.set');
  const fetchIdx = fnBody.indexOf('fetchWithRetry');
  assert(fetchIdx >= 0, 'fetchWithRetry not found in checkStalledFloors (need larger slice?)');
  assert(setIdx < fetchIdx, 'Cooldown timestamp must be set BEFORE fetchWithRetry (race protection)');
});

// ============================================================
// FIX-2-09: approve route has auth
// ============================================================
console.log('\nBUG-2-09: approve route missing authentication');
test('approve route imports getServerSession', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api', 'goals', '[id]', 'approve', 'route.ts'),
    'utf-8',
  );
  assert(src.includes("getServerSession"), 'Missing getServerSession import');
  assert(src.includes("authOptions"), 'Missing authOptions import');
});

test('approve route checks session before processing', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api', 'goals', '[id]', 'approve', 'route.ts'),
    'utf-8',
  );
  assert(src.includes("session?.user?.email"), 'Missing session email check');
  assert(src.includes("status: 401"), 'Missing 401 unauthorized response');
  // Verify the auth check is BEFORE goal loading
  const authIdx = src.indexOf("session?.user?.email");
  const goalIdx = src.indexOf("getGoal(goalId)");
  assert(authIdx < goalIdx, 'Auth check must come before getGoal call');
});

// ============================================================
// FIX-2-10: daily-scraper extraction has timeout
// ============================================================
console.log('\nBUG-2-10: daily-scraper extraction call has no timeout');
test('extractFromContent uses Promise.race with timeout', () => {
  const src = fs.readFileSync(path.join(LIB, 'daily-scraper.ts'), 'utf-8');
  assert(src.includes('Promise.race'), 'Missing Promise.race timeout wrapper');
});

test('extraction timeout is 30 seconds', () => {
  const src = fs.readFileSync(path.join(LIB, 'daily-scraper.ts'), 'utf-8');
  // Match numeric separators like 30_000
  const timeoutMatch = src.match(/setTimeout\(\(\)\s*=>\s*reject\(.*?\),\s*([\d_]+)/);
  assert(timeoutMatch, 'Missing setTimeout in Promise.race rejection');
  const timeoutMs = parseInt(timeoutMatch[1].replace(/_/g, ''), 10);
  assert(timeoutMs === 30000, `Timeout ${timeoutMs}ms is not 30s`);
});

test('extraction timeout error message is descriptive', () => {
  const src = fs.readFileSync(path.join(LIB, 'daily-scraper.ts'), 'utf-8');
  assert(
    src.includes('timed out') || src.includes('timeout'),
    'Timeout error message should mention timeout',
  );
});

// ============================================================
// Summary
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
  process.exit(1);
}
