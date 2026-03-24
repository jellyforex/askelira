# Steven Beta -- Installment 1: Fixes Log
**Date:** 2026-03-23
**Tests:** 21/21 passing

---

## SB-001 FIX: Move BRAVE_SEARCH_API_KEY to RECOMMENDED_VARS
- **File:** `lib/env-validator.ts`
- **Change:** Moved `BRAVE_SEARCH_API_KEY` from `REQUIRED_VARS` to `RECOMMENDED_VARS`. Added `TAVILY_API_KEY` to `RECOMMENDED_VARS`.
- **Rationale:** Search provider is now configurable (auto/tavily/brave/perplexity). Requiring Brave when Tavily is the default breaks production startup.
- **Lines changed:** 3

## SB-002 FIX: Add auth check to manual scrape endpoint
- **File:** `app/api/cron/scrape-patterns/manual/route.ts`
- **Change:** Added CRON_SECRET bearer token check matching the daily cron route's auth pattern. Returns 401 on mismatch.
- **Rationale:** Unauthenticated POST to scrape endpoint burns API credits.
- **Lines added:** 6

## SB-003 FIX: Return empty goals for unauthenticated users
- **File:** `app/api/goals/route.ts`
- **Change:** Replaced dual-path query (authenticated vs all-goals) with early return of `{ goals: [] }` when no session email. Removed the unscoped SELECT query entirely.
- **Rationale:** Information disclosure -- all customers' goals were visible without auth.
- **Lines changed:** -15 (net deletion)

## SB-004 FIX: Rewrite migration script to use @vercel/postgres
- **File:** `scripts/migrate-build-output-format.ts`
- **Change:** Replaced all `prisma.floor.findMany()` / `prisma.floor.update()` / `prisma.$disconnect()` with raw SQL via `sql` from `@vercel/postgres`. Removed nonexistent prisma import.
- **Rationale:** Script was completely broken (TS2339 error) since `lib/db.ts` has no prisma export.
- **Lines changed:** ~20

## SB-005 FIX: Validate floorId before rate limiting
- **File:** `app/api/loop/start/[floorId]/route.ts`
- **Change:** Moved `if (!floorId)` check before `checkRateLimit()` call. Removed redundant `if (floorId)` guard.
- **Rationale:** Empty floorId burned a rate limit slot on meaningless key `loop_start:`.
- **Lines changed:** 4

## SB-006 FIX: Validate goalId before rate limiting
- **File:** `app/api/heartbeat/[goalId]/route.ts`
- **Change:** Moved `if (!goalId)` check before `checkRateLimit()` call in POST handler. Removed redundant `if (goalId)` guard.
- **Rationale:** Same as SB-005 -- empty goalId wasted rate limit slots.
- **Lines changed:** 4

## SB-007 FIX: Read version from package.json
- **File:** `app/api/health/route.ts`
- **Change:** Replaced hardcoded `'2.1.0'` with `packageJson.version` via `import packageJson from '@/package.json'`.
- **Rationale:** Hardcoded version drifts silently on bumps, breaks monitoring.
- **Lines changed:** 2

## SB-008 FIX: Fetch heartbeat status on building page load
- **File:** `hooks/useBuilding.ts`
- **Change:** Added `useEffect` that fetches `/api/heartbeat/${goalId}` on mount, updating `heartbeatActive` and `lastHeartbeatAt` from the response. Also added `PendingExpansion` interface and `pendingExpansions` to `BuildingState`.
- **Rationale:** Without this, StevenStatus always showed "Idle" / "Last check: Never" on page load since heartbeat data was only updated via Socket.io events.
- **Lines added:** 18

## SB-009 FIX: Eliminate duplicate goal fetch
- **Files:** `hooks/useBuilding.ts`, `app/buildings/[goalId]/page.tsx`
- **Change:** Added `pendingExpansions` to hook's `ApiResponse` and `BuildingState`. Replaced page's separate `fetch(/api/goals/${goalId})` with a sync from hook data.
- **Rationale:** Two HTTP calls to the same endpoint on mount wasted bandwidth and created race conditions.
- **Lines changed:** 8

## SB-010 FIX: Convert sync fs to async in autonomous status
- **File:** `app/api/autonomous/status/route.ts`
- **Change:** Replaced `fs.existsSync()` + `fs.readFileSync()` with `fs.promises.readFile()` using try/catch for missing files.
- **Rationale:** Synchronous I/O blocks the Node.js event loop in a Next.js API route.
- **Lines changed:** 6
