# Steven Alpha -- Installment 4: Bug Report

**Date:** 2026-03-23
**Agent:** Steven (claude-opus-4-6)
**Scope:** Full codebase scan -- lib/, app/api/, middleware.ts
**Bugs Found:** 10 (numbered 31-40, continuing from Installment 3)

---

## Bug 31: Path Traversal in workspace-sync.ts via LLM File Names

**File:** `lib/workspace-sync.ts` (lines 57, 128)
**Severity:** CRITICAL
**Category:** Path Traversal / Security

David's LLM output contains `file.name` values that are written directly to the filesystem via `path.join(floorDir, file.name)`. A malicious or hallucinated file name like `../../etc/cron.d/backdoor` or `../../../home/user/.ssh/authorized_keys` would escape the floor directory and write to arbitrary filesystem locations.

Two affected code paths:
1. Line 57: `path.join(floorDir, file.name)` -- floor output files
2. Line 128: `path.join(automationSubDir, file.name)` -- automation files

---

## Bug 32: Cron Scrape-Patterns Auth Bypass When CRON_SECRET Unset

**File:** `app/api/cron/scrape-patterns/route.ts` (line 20)
**Severity:** HIGH
**Category:** Authentication Bypass

The auth check was: `if (cronSecret && authHeader !== ...)`. When `CRON_SECRET` is not set in production env vars, `cronSecret` is undefined/empty, the condition is falsy, and the entire auth check is skipped. Anyone can trigger the scraper, consuming Brave Search API credits and database writes.

---

## Bug 33: building-loop.ts Recursive runFloor() Stack Overflow

**File:** `lib/building-loop.ts` (line 803)
**Severity:** HIGH
**Category:** Stack Overflow / Resource Exhaustion

`runFloor()` calls itself recursively to process the next floor: `await runFloor(nextFloor.id)`. With 10+ floors, this adds 10+ stack frames, each holding full closures with agent call results. In the monolithic loop (which does Alba + Vex1 + David + Vex2 + Elira per floor), this could cause a stack overflow or exceed memory limits on Vercel.

---

## Bug 34: middleware.ts 'unknown' IP Bypasses All Rate Limiting

**File:** `middleware.ts` (line 51)
**Severity:** HIGH
**Category:** Rate Limiting Bypass / Security

The skip condition was: `ip === '127.0.0.1' || ip === 'localhost' || ip === '::1' || ip === 'unknown'`. On Vercel, if an attacker sends requests without `x-forwarded-for` or `x-real-ip` headers, the IP defaults to `'unknown'`, which completely bypasses the global rate limiter. This allows unlimited API requests.

---

## Bug 35: step-runner.ts Bare JSON.parse Without try/catch (7 Locations)

**File:** `lib/step-runner.ts` (lines 760, 857, 858, 1077, 1078, 1190, 1294)
**Severity:** HIGH
**Category:** Error Handling / Crash

Seven locations use `JSON.parse()` directly on DB-stored values (`floor.researchOutput`, `floor.vexGate1Report`, `floor.buildOutput`) without try/catch. If any of these DB fields contain corrupted data (e.g., truncated JSON from a DB timeout, or a non-JSON string from a migration error), the parse throws an unhandled error that crashes the entire step, potentially leaving the floor stuck.

The file already has a robust `parseJSON()` helper for LLM outputs but does NOT use it for DB-stored values.

Affected steps:
- `runVex1Step`: line 760 (`JSON.parse(floor.researchOutput)`)
- `runDavidStep`: lines 857-858 (`JSON.parse(floor.researchOutput)`, `JSON.parse(floor.vexGate1Report)`)
- `runVex2Step`: lines 1077-1078 (`JSON.parse(floor.researchOutput)`, `JSON.parse(floor.buildOutput)`)
- `runEliraStep`: line 1190 (`JSON.parse(floor.buildOutput)`)
- `runFinalizeStep`: line 1294 (`JSON.parse(floor.buildOutput)`)

---

## Bug 36: Manual Scrape Route Unbounded body.count

**File:** `app/api/cron/scrape-patterns/manual/route.ts` (line 33)
**Severity:** MEDIUM
**Category:** Input Validation / Resource Exhaustion

`const count = body.count ?? 3` has no upper bound. An attacker (after fixing the auth bypass in Bug 37) or a misconfigured client can pass `count: 1000`, causing the scraper to sequentially process 1000 categories with 2s delays between each = 2000+ seconds of execution, far exceeding the 300s maxDuration, and consuming thousands of Brave Search API calls.

---

## Bug 37: Manual Scrape Route Same CRON_SECRET Auth Bypass

**File:** `app/api/cron/scrape-patterns/manual/route.ts` (line 19)
**Severity:** HIGH
**Category:** Authentication Bypass

Same pattern as Bug 32: `if (cronSecret && authHeader !== ...)` allows unauthenticated access when `CRON_SECRET` env var is not set. The manual scrape route is even more dangerous because it accepts an arbitrary `categories` array and `count` parameter.

---

## Bug 38: Heartbeat Expansion Normalization Too Strict for Real Suggestions

**File:** `lib/heartbeat.ts` (lines 942-946)
**Severity:** MEDIUM
**Category:** Logic Error / Dead Feature

The expansion suggestion grouping uses `.toLowerCase().trim()` followed by exact string equality via Map counting. This means "Add monitoring for API errors" and "add monitoring for api errors" match, but "Add API monitoring" and "Add monitoring for API errors" do NOT match despite being semantically identical.

Since Steven generates suggestions via LLM calls, the exact wording will always vary slightly between heartbeat cycles. The 3-match threshold will virtually never be reached, making the expansion suggestion feature a dead letter.

---

## Bug 39: autonomous/status Route Has No Authentication, Leaks Server Config

**File:** `app/api/autonomous/status/route.ts` (lines 5-49)
**Severity:** MEDIUM
**Category:** Authentication / Information Disclosure

The route has no authentication at all. It reads `.autonomous-config.json` and `logs/autonomous-history.json` from the server filesystem and returns them in the response, including:
- `allowedPaths` -- reveals server directory structure
- `loopInterval`, `agentCount`, `maxIterations` -- reveals operational parameters
- `totalIterations`, `lastRun` -- reveals usage patterns

---

## Bug 40: build/route.ts Uses Raw waitUntil and fetch Without Timeout

**File:** `app/api/build/route.ts` (lines 6, 121-148)
**Severity:** MEDIUM
**Category:** Inconsistency / Silent Failure

The `/api/build` route imports `waitUntil` directly from `@vercel/functions` instead of using the `safeWaitUntil` wrapper from `lib/internal-fetch.ts`. Outside Vercel (local dev, self-hosted), the raw `waitUntil` is a silent no-op that drops the background promise.

Additionally, the `fetch()` call to start the building loop (line 130) has no AbortController timeout. If the loop start endpoint is slow or unreachable, the fetch hangs indefinitely.

The approve route and loop routes were already fixed to use `safeWaitUntil` and `fetchWithRetry` from `internal-fetch`, but the build route was missed.
