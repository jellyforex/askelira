/**
 * Steven Alpha -- Installment 4: Fix Verification Tests
 *
 * These tests verify each of the 10 bug fixes applied in installment 4.
 * Run: node test/steven-alpha-fixes-4.test.js
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

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const LIB = path.join(ROOT, 'lib');

console.log('\nSteven Alpha -- Installment 4: Fix Verification\n');

// ============================================================
// Bug 31: workspace-sync.ts path traversal in LLM file names
// ============================================================
console.log('Bug 31: workspace-sync.ts path traversal protection');

test('workspace-sync has sanitizeFileName function', () => {
  const src = fs.readFileSync(path.join(LIB, 'workspace-sync.ts'), 'utf-8');
  assert(src.includes('function sanitizeFileName'), 'Missing sanitizeFileName function');
  assert(src.includes('path.resolve'), 'sanitizeFileName should use path.resolve');
  assert(src.includes('startsWith(normalizedParent)'), 'Should check resolved path stays inside parent');
});

test('workspace-sync uses sanitizeFileName for floor files', () => {
  const src = fs.readFileSync(path.join(LIB, 'workspace-sync.ts'), 'utf-8');
  // Should use sanitizeFileName instead of direct path.join with file.name
  assert(src.includes('sanitizeFileName(file.name, floorDir)'), 'Should sanitize file names in floor dir');
  assert(!src.includes('path.join(floorDir, file.name)'), 'Should NOT use raw path.join with file.name for floor dir');
});

test('workspace-sync uses sanitizeFileName for automation files', () => {
  const src = fs.readFileSync(path.join(LIB, 'workspace-sync.ts'), 'utf-8');
  assert(src.includes('sanitizeFileName(file.name, automationSubDir)'), 'Should sanitize file names in automation dir');
  assert(!src.includes('path.join(automationSubDir, file.name)'), 'Should NOT use raw path.join with file.name for automation dir');
});

test('workspace-sync skips files that fail sanitization', () => {
  const src = fs.readFileSync(path.join(LIB, 'workspace-sync.ts'), 'utf-8');
  assert(src.includes('if (!safePath) continue'), 'Should skip files that fail sanitization');
  assert(src.includes('Blocked path traversal attempt'), 'Should warn about traversal attempts');
});

// ============================================================
// Bug 32: cron scrape-patterns auth bypass when CRON_SECRET unset
// ============================================================
console.log('\nBug 32: cron scrape-patterns auth bypass when CRON_SECRET unset');

test('scrape-patterns rejects when CRON_SECRET not set', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/cron/scrape-patterns/route.ts'),
    'utf-8',
  );
  assert(src.includes('if (!cronSecret)'), 'Should check for missing CRON_SECRET');
  assert(src.includes('CRON_SECRET not set'), 'Should log error when CRON_SECRET missing');
  assert(src.includes('status: 500'), 'Should return 500 when CRON_SECRET not configured');
});

test('scrape-patterns no longer uses conditional auth pattern', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/cron/scrape-patterns/route.ts'),
    'utf-8',
  );
  // The old pattern: if (cronSecret && authHeader !== ...) allowed bypass
  assert(!src.includes('if (cronSecret && authHeader'), 'Should NOT use conditional auth pattern');
});

// ============================================================
// Bug 33: building-loop.ts recursive runFloor stack overflow
// ============================================================
console.log('\nBug 33: building-loop.ts recursive runFloor bounded depth');

test('runFloor has depth parameter', () => {
  const src = fs.readFileSync(path.join(LIB, 'building-loop.ts'), 'utf-8');
  assert(src.includes('_depth: number = 0'), 'runFloor should have _depth parameter with default 0');
  assert(src.includes('MAX_FLOOR_DEPTH'), 'Should define MAX_FLOOR_DEPTH constant');
});

test('runFloor checks depth before recursing', () => {
  const src = fs.readFileSync(path.join(LIB, 'building-loop.ts'), 'utf-8');
  assert(src.includes('_depth >= MAX_FLOOR_DEPTH'), 'Should check depth against MAX_FLOOR_DEPTH');
  assert(src.includes('Max recursion depth'), 'Should log when max depth reached');
});

test('recursive call passes _depth + 1', () => {
  const src = fs.readFileSync(path.join(LIB, 'building-loop.ts'), 'utf-8');
  assert(src.includes('runFloor(nextFloor.id, _depth + 1)'), 'Recursive call should increment depth');
});

// ============================================================
// Bug 34: middleware.ts unknown IP bypasses rate limiting
// ============================================================
console.log('\nBug 34: middleware.ts unknown IP no longer bypasses rate limiting');

test('middleware does not skip rate limiting for unknown IP', () => {
  const src = fs.readFileSync(path.join(ROOT, 'middleware.ts'), 'utf-8');
  // Find the specific localhost skip line
  const lines = src.split('\n');
  const skipLineIdx = lines.findIndex(l => l.includes("ip === '127.0.0.1'"));
  assert(skipLineIdx > -1, 'Should have localhost skip line');
  const skipLine = lines[skipLineIdx];
  assert(!skipLine.includes("'unknown'"), 'Skip line should NOT include unknown');
  assert(skipLine.includes("'127.0.0.1'"), 'Should still skip for 127.0.0.1');
  assert(skipLine.includes("'::1'"), 'Should still skip for ::1');
});

// ============================================================
// Bug 35: step-runner.ts bare JSON.parse without try/catch
// ============================================================
console.log('\nBug 35: step-runner.ts safe JSON parsing for DB values');

test('step-runner has safeParseDBJson helper', () => {
  const src = fs.readFileSync(path.join(LIB, 'step-runner.ts'), 'utf-8');
  assert(src.includes('function safeParseDBJson'), 'Should define safeParseDBJson helper');
  assert(src.includes('returns null on failure'), 'Should document that it returns null');
});

test('Vex1 step uses safeParseDBJson for researchOutput', () => {
  const src = fs.readFileSync(path.join(LIB, 'step-runner.ts'), 'utf-8');
  const vex1Fn = src.slice(src.indexOf('async function runVex1Step'));
  const vex1Body = vex1Fn.slice(0, vex1Fn.indexOf('\nexport '));
  assert(vex1Body.includes('safeParseDBJson<AlbaResult>'), 'Vex1 should use safeParseDBJson for Alba result');
  assert(!vex1Body.includes('JSON.parse(floor.researchOutput)'), 'Vex1 should NOT use bare JSON.parse on researchOutput');
});

test('David step uses safeParseDBJson for researchOutput and vexGate1Report', () => {
  const src = fs.readFileSync(path.join(LIB, 'step-runner.ts'), 'utf-8');
  const davidFn = src.slice(src.indexOf('async function runDavidStep'));
  const davidBody = davidFn.slice(0, davidFn.indexOf('\nexport '));
  assert(davidBody.includes("safeParseDBJson<AlbaResult>(floor.researchOutput"), 'David should safely parse researchOutput');
  assert(davidBody.includes("safeParseDBJson<VexGate1Result>(floor.vexGate1Report"), 'David should safely parse vexGate1Report');
});

test('Vex2 step uses safeParseDBJson for researchOutput and buildOutput', () => {
  const src = fs.readFileSync(path.join(LIB, 'step-runner.ts'), 'utf-8');
  const vex2Fn = src.slice(src.indexOf('async function runVex2Step'));
  const vex2Body = vex2Fn.slice(0, vex2Fn.indexOf('\nexport '));
  assert(vex2Body.includes("safeParseDBJson<AlbaResult>(floor.researchOutput"), 'Vex2 should safely parse researchOutput');
  assert(vex2Body.includes("safeParseDBJson<Record<string, unknown>>(floor.buildOutput"), 'Vex2 should safely parse buildOutput');
});

test('Elira step uses safeParseDBJson for buildOutput', () => {
  const src = fs.readFileSync(path.join(LIB, 'step-runner.ts'), 'utf-8');
  const eliraFn = src.slice(src.indexOf('async function runEliraStep'));
  const eliraBody = eliraFn.slice(0, eliraFn.indexOf('\nexport '));
  assert(eliraBody.includes("safeParseDBJson<Record<string, unknown>>(floor.buildOutput"), 'Elira should safely parse buildOutput');
  assert(!eliraBody.includes('JSON.parse(floor.buildOutput)'), 'Elira should NOT use bare JSON.parse on buildOutput');
});

test('Finalize step uses safeParseDBJson for buildOutput', () => {
  const src = fs.readFileSync(path.join(LIB, 'step-runner.ts'), 'utf-8');
  const finalizeFn = src.slice(src.indexOf('async function runFinalizeStep'));
  const finalizeBody = finalizeFn.slice(0, finalizeFn.indexOf('\nexport '));
  assert(finalizeBody.includes("safeParseDBJson<Record<string, unknown>>(floor.buildOutput"), 'Finalize should safely parse buildOutput');
  assert(!finalizeBody.includes('JSON.parse(floor.buildOutput)'), 'Finalize should NOT use bare JSON.parse on buildOutput');
});

// ============================================================
// Bug 36: manual scrape unbounded body.count
// ============================================================
console.log('\nBug 36: manual scrape bounded count');

test('manual scrape caps count at max 20', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/cron/scrape-patterns/manual/route.ts'),
    'utf-8',
  );
  assert(src.includes('Math.min(rawCount, 20)'), 'Should cap count at 20');
  assert(src.includes('Math.max(1,'), 'Should enforce minimum of 1');
});

test('manual scrape validates count is a number', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/cron/scrape-patterns/manual/route.ts'),
    'utf-8',
  );
  assert(src.includes("typeof body.count === 'number'"), 'Should check count is a number');
});

// ============================================================
// Bug 37: manual scrape CRON_SECRET bypass
// ============================================================
console.log('\nBug 37: manual scrape CRON_SECRET bypass fixed');

test('manual scrape rejects when CRON_SECRET not set', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/cron/scrape-patterns/manual/route.ts'),
    'utf-8',
  );
  assert(src.includes('if (!cronSecret)'), 'Should check for missing CRON_SECRET');
  assert(src.includes('CRON_SECRET not set'), 'Should log error when CRON_SECRET missing');
});

test('manual scrape no longer uses conditional auth pattern', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/cron/scrape-patterns/manual/route.ts'),
    'utf-8',
  );
  assert(!src.includes('if (cronSecret && authHeader'), 'Should NOT use conditional auth pattern');
});

// ============================================================
// Bug 38: heartbeat expansion suggestion normalization
// ============================================================
console.log('\nBug 38: heartbeat expansion uses Jaccard similarity clustering');

test('heartbeat uses jaccardSimilarity for suggestion grouping', () => {
  const src = fs.readFileSync(path.join(LIB, 'heartbeat.ts'), 'utf-8');
  assert(src.includes('function jaccardSimilarity'), 'Should define jaccardSimilarity function');
  assert(src.includes('function getWords'), 'Should define getWords helper');
  assert(src.includes('intersection'), 'jaccardSimilarity should calculate intersection');
});

test('heartbeat clusters suggestions instead of exact matching', () => {
  const src = fs.readFileSync(path.join(LIB, 'heartbeat.ts'), 'utf-8');
  const expansionFn = src.slice(src.indexOf('async function checkExpansionOpportunity'));
  // Should use cluster-based grouping, not exact Map-based counting
  assert(expansionFn.includes('clusters'), 'Should use cluster-based grouping');
  assert(expansionFn.includes('>= 0.6'), 'Should use 0.6 Jaccard threshold');
  // Should NOT use the old exact-match normalization
  assert(!expansionFn.includes("counts.set(normalized,"), 'Should NOT use exact-match counting via Map');
});

test('heartbeat expansion words filtering removes short words', () => {
  const src = fs.readFileSync(path.join(LIB, 'heartbeat.ts'), 'utf-8');
  assert(src.includes('w.length > 2'), 'getWords should filter words shorter than 3 chars');
});

// ============================================================
// Bug 39: autonomous/status no auth, leaks config
// ============================================================
console.log('\nBug 39: autonomous/status has authentication');

test('autonomous/status imports getServerSession', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/autonomous/status/route.ts'),
    'utf-8',
  );
  assert(src.includes("import { getServerSession }"), 'Should import getServerSession');
  assert(src.includes("import { authOptions }"), 'Should import authOptions');
});

test('autonomous/status checks session before serving config', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/autonomous/status/route.ts'),
    'utf-8',
  );
  const authIdx = src.indexOf('getServerSession(authOptions)');
  const configIdx = src.indexOf('.autonomous-config.json');
  assert(authIdx > -1, 'Should call getServerSession');
  assert(configIdx > -1, 'Should read config file');
  assert(authIdx < configIdx, 'Auth check must come before config read');
});

test('autonomous/status does not leak allowedPaths', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/autonomous/status/route.ts'),
    'utf-8',
  );
  // Should NOT expose allowedPaths in the response
  const responseSection = src.slice(src.indexOf('return NextResponse.json'));
  assert(!responseSection.includes('allowedPaths: config.allowedPaths'), 'Should NOT include allowedPaths in response');
  assert(responseSection.includes('allowedPaths intentionally omitted'), 'Should document why allowedPaths is omitted');
});

// ============================================================
// Bug 40: build route uses raw waitUntil and fetch without timeout
// ============================================================
console.log('\nBug 40: build route uses safeWaitUntil and fetch timeout');

test('build route imports safeWaitUntil instead of waitUntil', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/build/route.ts'),
    'utf-8',
  );
  assert(src.includes("import { safeWaitUntil, getInternalBaseUrl }"), 'Should import safeWaitUntil from internal-fetch');
  assert(!src.includes("import { waitUntil } from '@vercel/functions'"), 'Should NOT import waitUntil from @vercel/functions');
});

test('build route uses safeWaitUntil instead of waitUntil', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/build/route.ts'),
    'utf-8',
  );
  assert(src.includes('safeWaitUntil(buildPromise)'), 'Should use safeWaitUntil');
  assert(!src.match(/\bwaitUntil\(buildPromise\)/), 'Should NOT use bare waitUntil');
});

test('build route uses getInternalBaseUrl instead of inline URL construction', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/build/route.ts'),
    'utf-8',
  );
  assert(src.includes('getInternalBaseUrl()'), 'Should use getInternalBaseUrl()');
  assert(!src.includes("process.env.VERCEL_URL"), 'Should NOT construct URL inline from VERCEL_URL');
});

test('build route fetch has AbortController timeout', () => {
  const src = fs.readFileSync(
    path.join(APP, 'api/build/route.ts'),
    'utf-8',
  );
  assert(src.includes('new AbortController()'), 'Should create AbortController');
  assert(src.includes('AbortError'), 'Should handle AbortError');
  // Timeout should be 10 seconds
  const timeoutMatch = src.match(/setTimeout\(\(\)\s*=>\s*abortCtrl\.abort\(\),\s*([\d_]+)\)/);
  assert(timeoutMatch, 'Should have setTimeout for abort');
  const timeoutMs = parseInt(timeoutMatch[1].replace(/_/g, ''));
  assert(timeoutMs === 10000, `Timeout should be 10000ms, got ${timeoutMs}`);
});

// ============================================================
// Summary
// ============================================================

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
