# Steven Alpha -- Installment 2: Bug Report

10 bugs found, 10 fixed.

---

## BUG-2-01: braveSearch() missing fetch timeout
- **File**: `lib/tools/brave-search.ts:19`
- **Severity**: HIGH
- **Description**: The `braveSearch()` function calls `fetch()` with no `AbortController` or timeout. If the Brave Search API is slow or unresponsive, the fetch hangs indefinitely, blocking the calling agent (Alba research step) and eventually hitting the Vercel function timeout with no useful error message.

## BUG-2-02: addFloorToSubscription Stripe quantity off-by-one
- **File**: `lib/subscription-manager.ts:178`
- **Severity**: HIGH
- **Description**: `addFloorToSubscription()` first increments `floors_active` in the DB (line 146), then reads the subscription back (line 161). At this point `sub.floorsActive` is already the NEW value (e.g., 2). But line 178 does `sub.floorsActive + 1` which sets the Stripe quantity to N+2 instead of N+1. The comment "because DB was just incremented" is backwards -- the value was read AFTER the increment.

## BUG-2-03: swarm-cache no periodic cleanup
- **File**: `lib/swarm-cache.ts`
- **Severity**: MEDIUM
- **Description**: The swarm cache evicts entries by capacity (MAX_ENTRIES=100) and checks expiry on `cacheGet()`, but there is no periodic cleanup of expired entries. If entries are written but never read, they persist indefinitely in memory. On a long-lived server.js process, this causes unbounded memory growth.

## BUG-2-04: snapshots route missing authentication
- **File**: `app/api/floors/[floorId]/snapshots/route.ts`
- **Severity**: HIGH
- **Description**: The GET endpoint for floor snapshots has no authentication check. Any unauthenticated user who knows a floorId can enumerate all snapshots, potentially leaking build state, research outputs, and proprietary automation code.

## BUG-2-05: expand route missing rate limiting
- **File**: `app/api/goals/[id]/expand/route.ts`
- **Severity**: HIGH
- **Description**: The expand endpoint has no rate limiting. An attacker (or accidental client bug) could repeatedly expand a goal, creating unlimited floors and triggering unlimited LLM calls (Alba, Vex, David) at $0.50+ per floor, causing significant cost exposure even though auth was present.

## BUG-2-06: logs route masks DB errors as empty 200
- **File**: `app/api/goals/[id]/logs/route.ts:121`
- **Severity**: MEDIUM
- **Description**: When the database is unavailable or returns an error, the catch block returns `{ logs: [] }` with HTTP 200. This masks production DB failures as "no logs exist." Callers (CLI, frontend) cannot distinguish between "no logs" and "DB is down," causing silent data loss in monitoring dashboards.

## BUG-2-07: chainNextStep missing fetch timeout
- **File**: `lib/step-runner.ts:291`
- **Severity**: HIGH
- **Description**: `chainNextStep()` calls `fetch()` with no `AbortController`. Unlike `fetchWithRetry()` (which has a 5s timeout), this bare fetch can hang indefinitely. Since `chainNextStep` is called from heartbeat rerun/escalation handlers, a hanging fetch blocks the heartbeat cycle entirely.

## BUG-2-08: stall recovery restart storm
- **File**: `lib/heartbeat.ts:821-893`
- **Severity**: HIGH
- **Description**: `checkStalledFloors()` has no cooldown between restart attempts for the same floor. If a stalled floor fails to recover after the first restart, the next heartbeat cycle (5 minutes later) will detect it as stalled again and restart it again, creating an infinite restart loop. Each restart triggers a new LLM call chain, wasting API credits.

## BUG-2-09: approve route missing authentication
- **File**: `app/api/goals/[id]/approve/route.ts`
- **Severity**: CRITICAL
- **Description**: The approve endpoint has no authentication check. Any unauthenticated user who knows a goalId can approve a building plan and trigger the full LLM building loop (Alba research, Vex auditing, David building). This is the most expensive operation in the system ($2-10+ per full build) and can be triggered freely.

## BUG-2-10: daily-scraper extraction call has no timeout
- **File**: `lib/daily-scraper.ts:145`
- **Severity**: MEDIUM
- **Description**: `extractFromContent()` calls `routeAgentCall()` with no timeout. The cron job has a 5-minute `maxDuration`, and it processes up to 10 categories with 3 pages each (30 extraction calls). If even one Claude API call hangs, it blocks the entire cron job, preventing pattern extraction for all remaining categories.
