/**
 * Steven Beta -- Installment 1: Regression Tests
 *
 * Verifies all 10 bug fixes from Installment 1.
 * Run: npx tsx test/test-steven-beta-installment-1.ts
 */

import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  // ── SB-001: BRAVE_SEARCH_API_KEY moved from REQUIRED to RECOMMENDED ──
  console.log('\nSB-001: env-validator no longer requires BRAVE_SEARCH_API_KEY');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../lib/env-validator.ts'),
      'utf-8',
    );
    // Extract REQUIRED_VARS array content
    const requiredMatch = src.match(/REQUIRED_VARS\s*=\s*\[([\s\S]*?)\]/);
    const recommendedMatch = src.match(/RECOMMENDED_VARS\s*=\s*\[([\s\S]*?)\]/);
    assert(
      requiredMatch != null && !requiredMatch[1].includes('BRAVE_SEARCH_API_KEY'),
      'BRAVE_SEARCH_API_KEY not in REQUIRED_VARS',
    );
    assert(
      recommendedMatch != null && recommendedMatch[1].includes('BRAVE_SEARCH_API_KEY'),
      'BRAVE_SEARCH_API_KEY is in RECOMMENDED_VARS',
    );
    assert(
      recommendedMatch != null && recommendedMatch[1].includes('TAVILY_API_KEY'),
      'TAVILY_API_KEY added to RECOMMENDED_VARS',
    );
  }

  // ── SB-002: Manual scrape has auth check ──
  console.log('\nSB-002: Manual scrape endpoint has auth check');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../app/api/cron/scrape-patterns/manual/route.ts'),
      'utf-8',
    );
    assert(
      src.includes('CRON_SECRET') && src.includes('authorization'),
      'Manual scrape checks CRON_SECRET via authorization header',
    );
    assert(
      src.includes("status: 401"),
      'Returns 401 on failed auth',
    );
  }

  // ── SB-003: Goals list no longer leaks all goals ──
  console.log('\nSB-003: Goals list requires authentication');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../app/api/goals/route.ts'),
      'utf-8',
    );
    // Should NOT have an unscoped SELECT without WHERE
    assert(
      !src.includes('GROUP BY g.id\n          ORDER BY g.created_at DESC\n        `;\n        rows = result.rows;\n      }'),
      'No unscoped SELECT ALL query for unauthenticated users',
    );
    assert(
      src.includes("!session?.user?.email"),
      'Checks for missing session email',
    );
  }

  // ── SB-004: Migration script uses sql instead of prisma ──
  console.log('\nSB-004: Migration script uses @vercel/postgres');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../scripts/migrate-build-output-format.ts'),
      'utf-8',
    );
    assert(
      !src.includes('prisma'),
      'No prisma references in migration script',
    );
    assert(
      src.includes("@vercel/postgres"),
      'Uses @vercel/postgres sql import',
    );
    assert(
      src.includes('UPDATE floors SET build_output'),
      'Uses raw SQL UPDATE instead of prisma.floor.update',
    );
  }

  // ── SB-005: Loop start validates floorId before rate limit ──
  console.log('\nSB-005: Loop start validates floorId before rate limiting');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../app/api/loop/start/[floorId]/route.ts'),
      'utf-8',
    );
    const nullCheckIdx = src.indexOf("if (!floorId)");
    const rateLimitIdx = src.indexOf("checkRateLimit(`loop_start:");
    assert(
      nullCheckIdx < rateLimitIdx,
      'floorId null check comes before rate limit check',
    );
  }

  // ── SB-006: Heartbeat POST validates goalId before rate limit ──
  console.log('\nSB-006: Heartbeat POST validates goalId before rate limiting');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../app/api/heartbeat/[goalId]/route.ts'),
      'utf-8',
    );
    // Find the POST handler section (after line ~66)
    const postSection = src.substring(src.indexOf('export async function POST'));
    const nullCheckIdx = postSection.indexOf("if (!goalId)");
    const rateLimitIdx = postSection.indexOf("checkRateLimit(`heartbeat:");
    assert(
      nullCheckIdx < rateLimitIdx,
      'goalId null check comes before rate limit check in POST handler',
    );
  }

  // ── SB-007: Health endpoint reads version from package.json ──
  console.log('\nSB-007: Health endpoint reads version from package.json');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../app/api/health/route.ts'),
      'utf-8',
    );
    assert(
      src.includes('packageJson.version') || src.includes('package.json'),
      'Version comes from package.json, not hardcoded',
    );
    assert(
      !src.includes("version: '2.1.0'"),
      'No hardcoded version string',
    );
  }

  // ── SB-008: useBuilding fetches heartbeat status on load ──
  console.log('\nSB-008: useBuilding fetches heartbeat status');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../hooks/useBuilding.ts'),
      'utf-8',
    );
    assert(
      src.includes('/api/heartbeat/'),
      'Hook fetches heartbeat API on mount',
    );
    assert(
      src.includes('data.status.active'),
      'Reads active state from heartbeat response',
    );
    assert(
      src.includes('data.status.lastCheckedAt'),
      'Reads lastCheckedAt from heartbeat response',
    );
  }

  // ── SB-009: Building page no longer double-fetches goals ──
  console.log('\nSB-009: Building page uses hook data for expansions');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../app/buildings/[goalId]/page.tsx'),
      'utf-8',
    );
    // Should NOT have a standalone fetch to /api/goals/ for pendingExpansions
    const expansionFetchCount = (src.match(/fetch\(`\/api\/goals\/\$\{goalId\}`\)/g) || []).length;
    assert(
      expansionFetchCount === 0,
      'No duplicate fetch to /api/goals/${goalId} in building page',
    );
    assert(
      src.includes('building?.pendingExpansions') || src.includes('building.pendingExpansions'),
      'Uses pendingExpansions from hook data',
    );
  }

  // ── SB-010: Autonomous status uses async fs ──
  console.log('\nSB-010: Autonomous status uses async fs');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../app/api/autonomous/status/route.ts'),
      'utf-8',
    );
    assert(
      src.includes("fs/promises") || src.includes("fs.promises"),
      'Uses async fs (fs/promises)',
    );
    assert(
      !src.includes('readFileSync') && !src.includes('existsSync'),
      'No sync fs calls',
    );
  }

  // ── Summary ──
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Steven Beta Installment 1: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
