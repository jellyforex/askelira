# Steven Beta -- Installment 1: Bug Report
**Date:** 2026-03-23
**Domain:** Frontend, Dashboard UI, Config, Integration

---

## SB-001: env-validator requires BRAVE_SEARCH_API_KEY but search provider is configurable
- **File:** `lib/env-validator.ts`
- **Line:** 18
- **Description:** `BRAVE_SEARCH_API_KEY` is listed in `REQUIRED_VARS`, but the system now supports `SEARCH_PROVIDER=auto|tavily|brave|perplexity`. Users with only Tavily configured get a startup crash in production.
- **Severity:** HIGH

## SB-002: Manual scrape endpoint has no auth check
- **File:** `app/api/cron/scrape-patterns/manual/route.ts`
- **Line:** 14
- **Description:** The daily cron scrape at `/api/cron/scrape-patterns` checks `authorization: Bearer ${CRON_SECRET}`, but the manual trigger endpoint at `/manual` has zero authentication. Anyone can POST to trigger unlimited web scrapes, burning API credits and scraper time.
- **Severity:** HIGH

## SB-003: Goals list leaks all goals to unauthenticated users
- **File:** `app/api/goals/route.ts`
- **Lines:** 33-50
- **Description:** When no session email is present, the endpoint returns ALL goals from ALL customers in the database instead of returning empty or 401. This is an information disclosure vulnerability.
- **Severity:** HIGH

## SB-004: Migration script imports nonexistent `prisma` from db.ts
- **File:** `scripts/migrate-build-output-format.ts`
- **Line:** 24
- **Description:** Script does `const { prisma } = await import('../lib/db')` but `lib/db.ts` only exports `getUserUsage` and `incrementDebateCount` -- no prisma client. Script crashes with TS2339 and cannot run.
- **Severity:** MEDIUM

## SB-005: Loop start rate-limits before validating floorId
- **File:** `app/api/loop/start/[floorId]/route.ts`
- **Lines:** 19-34
- **Description:** Rate limit check at L19 runs BEFORE the floorId null check at L29. If floorId is empty, a rate limit slot is burned on key `loop_start:` with no useful work done. The validation should come first.
- **Severity:** LOW

## SB-006: Heartbeat POST rate-limits before validating goalId
- **File:** `app/api/heartbeat/[goalId]/route.ts`
- **Lines:** 74-90
- **Description:** Same pattern as SB-005. Rate limit check at L74 runs before goalId null check at L85. Burns a rate limit slot on empty key `heartbeat:`.
- **Severity:** LOW

## SB-007: Health endpoint hardcodes version string
- **File:** `app/api/health/route.ts`
- **Line:** 14
- **Description:** Version is hardcoded as `'2.1.0'` instead of reading from `package.json`. Will silently drift on any version bump, making monitoring dashboards show stale versions.
- **Severity:** LOW

## SB-008: StevenStatus always shows "Idle" / "Never" on page load
- **File:** `hooks/useBuilding.ts`
- **Lines:** 118-119
- **Description:** `parseApiResponse()` always sets `heartbeatActive: false` and `lastHeartbeatAt: null`. The heartbeat API exists at `/api/heartbeat/${goalId}` and returns the real active state, but `useBuildingState` never fetches it. Users always see Steven as "Idle" until a socket heartbeat event fires -- which may never happen if socket fails to connect.
- **Severity:** MEDIUM

## SB-009: Building detail page double-fetches goal data on mount
- **File:** `app/buildings/[goalId]/page.tsx`
- **Lines:** 92-104
- **Description:** `useBuildingState(goalId)` already fetches `/api/goals/${goalId}`. A separate `useEffect` at L92 also fetches the same endpoint for `pendingExpansions`. The API already returns `pendingExpansions` in its response, so the hook should pass it through instead of a duplicate HTTP call.
- **Severity:** LOW

## SB-010: Autonomous status route uses sync fs in API handler
- **File:** `app/api/autonomous/status/route.ts`
- **Lines:** 12-27
- **Description:** Uses `fs.existsSync()` + `fs.readFileSync()` twice in a Next.js API route handler. Synchronous file I/O blocks the Node.js event loop. Should use `fs.promises` equivalents.
- **Severity:** LOW
