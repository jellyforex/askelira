# Steven Alpha -- Installment 4: Fix Log

**Date:** 2026-03-23
**Agent:** Steven (claude-opus-4-6)
**Bugs Fixed:** 10 (numbered 31-40)
**Tests Written:** 30
**Regressions:** 0

---

## Bug 31 Fix: Path Traversal Protection in workspace-sync.ts

**File:** `lib/workspace-sync.ts`
**Root Cause:** `file.name` from David's LLM output written directly to filesystem via `path.join(dir, file.name)` with no validation.
**Fix:**
- Added `sanitizeFileName(name, parentDir)` function that:
  1. Strips null bytes and whitespace
  2. Resolves the full path via `path.resolve(parentDir, name)`
  3. Validates the resolved path starts with the parent directory
  4. Returns `null` if the path escapes the parent (traversal detected)
- Replaced both `path.join(floorDir, file.name)` and `path.join(automationSubDir, file.name)` with calls to `sanitizeFileName()`
- Files that fail sanitization are silently skipped with a warning log
**Tests:** 4

---

## Bug 32 Fix: Cron Scrape-Patterns Auth Bypass

**File:** `app/api/cron/scrape-patterns/route.ts`
**Root Cause:** `if (cronSecret && authHeader !== ...)` skips auth when CRON_SECRET is undefined.
**Fix:** Split into two checks:
1. `if (!cronSecret)` -> return 500 "CRON_SECRET not configured"
2. `if (authHeader !== ...)` -> return 401 "Unauthorized"
**Tests:** 2

---

## Bug 33 Fix: building-loop.ts Recursive Stack Overflow

**File:** `lib/building-loop.ts`
**Root Cause:** `runFloor(nextFloor.id)` recurses without depth limit.
**Fix:**
- Added `MAX_FLOOR_DEPTH = 20` constant
- Added `_depth: number = 0` parameter to `runFloor()`
- Added depth check at function entry: `if (_depth >= MAX_FLOOR_DEPTH)` returns gracefully
- Updated recursive call to `runFloor(nextFloor.id, _depth + 1)`
- When max depth is reached, logs error and returns 'live'. Remaining floors will be picked up by heartbeat stall recovery.
**Tests:** 3

---

## Bug 34 Fix: middleware.ts 'unknown' IP Rate Limit Bypass

**File:** `middleware.ts`
**Root Cause:** `ip === 'unknown'` was in the localhost skip list, letting headerless requests bypass rate limiting.
**Fix:** Removed `|| ip === 'unknown'` from the skip condition. Now only `127.0.0.1`, `localhost`, and `::1` bypass the global rate limiter.
**Tests:** 1

---

## Bug 35 Fix: step-runner.ts Safe JSON Parsing for DB Values

**File:** `lib/step-runner.ts`
**Root Cause:** 7 bare `JSON.parse()` calls on DB-stored values crash on corrupted data.
**Fix:**
- Added `safeParseDBJson<T>(raw, label)` helper that returns `null` on parse failure (with error log) instead of throwing
- Replaced all 7 `JSON.parse()` calls with `safeParseDBJson()`:
  - `runVex1Step`: researchOutput
  - `runDavidStep`: researchOutput, vexGate1Report
  - `runVex2Step`: researchOutput, buildOutput
  - `runEliraStep`: buildOutput
  - `runFinalizeStep`: buildOutput
- Each null result throws a descriptive error (e.g., "corrupted research output") instead of a cryptic JSON parse error
**Tests:** 7

---

## Bug 36 Fix: Manual Scrape Unbounded Count

**File:** `app/api/cron/scrape-patterns/manual/route.ts`
**Root Cause:** `body.count` was used without bounds checking. Non-numeric values also passed through.
**Fix:**
- Type check: `typeof body.count === 'number'` with fallback to 3
- Bounded: `Math.max(1, Math.min(rawCount, 20))` -- minimum 1, maximum 20
**Tests:** 2

---

## Bug 37 Fix: Manual Scrape CRON_SECRET Auth Bypass

**File:** `app/api/cron/scrape-patterns/manual/route.ts`
**Root Cause:** Same pattern as Bug 32: `if (cronSecret && authHeader !== ...)` skips auth when CRON_SECRET is undefined.
**Fix:** Same pattern as Bug 32:
1. `if (!cronSecret)` -> return 500 "CRON_SECRET not configured"
2. `if (authHeader !== ...)` -> return 401 "Unauthorized"
**Tests:** 2

---

## Bug 38 Fix: Heartbeat Expansion Suggestion Clustering

**File:** `lib/heartbeat.ts`
**Root Cause:** Exact string matching (after toLowerCase/trim) for suggestion grouping. LLM-generated suggestions always vary slightly in wording, making the 3-match threshold unreachable.
**Fix:**
- Replaced exact-match Map counting with Jaccard similarity clustering:
  - `getWords(text)`: tokenizes into words > 2 chars, removes punctuation, lowercases
  - `jaccardSimilarity(a, b)`: computes word-set overlap ratio (intersection / union)
  - Threshold: 0.6 (60% word overlap = same suggestion cluster)
- Suggestions are grouped into clusters; a cluster with 3+ members triggers expansion evaluation
- Now "Add monitoring for API errors" and "Add API monitoring" correctly cluster together
**Tests:** 3

---

## Bug 39 Fix: autonomous/status Route Authentication + Config Leak

**File:** `app/api/autonomous/status/route.ts`
**Root Cause:** No authentication. Exposes server config including `allowedPaths` (directory structure leak).
**Fix:**
- Added `getServerSession(authOptions)` check at start of handler
- Removed `allowedPaths` from response body (still returns `loopInterval`, `agentCount`, `maxIterations` which are non-sensitive operational params)
- Added comment documenting why allowedPaths is omitted
**Tests:** 3

---

## Bug 40 Fix: build/route.ts Uses safeWaitUntil and Fetch Timeout

**File:** `app/api/build/route.ts`
**Root Cause:** Imports `waitUntil` from `@vercel/functions` (no-op outside Vercel) and uses `fetch()` without timeout.
**Fix:**
- Changed import to `safeWaitUntil, getInternalBaseUrl` from `@/lib/internal-fetch`
- Replaced inline URL construction (`process.env.VERCEL_URL ? ...`) with `getInternalBaseUrl()`
- Added `AbortController` with 10s timeout to the fetch call
- Added `AbortError` handling (logs as expected fire-and-forget timeout)
- Renamed inner AbortController to `abortCtrl` to avoid shadowing ReadableStream's `controller` parameter
- Replaced `waitUntil(buildPromise)` with `safeWaitUntil(buildPromise)`
**Tests:** 4

---

## Verification

```
Installment 1: 19/19 tests passed
Installment 2: 24/24 tests passed
Installment 3: 30/30 tests passed
Installment 4: 30/30 tests passed
Total: 103 tests, 0 failures, 0 regressions
```

TypeScript check: 0 new errors (103 pre-existing @types/next TS7016 errors remain, plus 5 pre-existing type mismatches in step-runner.ts patternValidation/swarmValidation area).
