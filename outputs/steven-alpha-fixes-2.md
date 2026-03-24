# Steven Alpha -- Installment 2: Fix Log

10 bugs fixed.

---

## FIX-2-01: Add 15s timeout to braveSearch fetch
- **File**: `lib/tools/brave-search.ts`
- **Before**: `fetch(url.toString(), { headers: {...} })`
- **After**: Added `AbortController` with 15s timeout, `signal: controller.signal`, and `clearTimeout(timeoutId)` after response.
- **Why 15s**: Brave Search typically responds in 1-3s. 15s is generous enough for slow networks but prevents indefinite hangs.

## FIX-2-02: Fix Stripe quantity off-by-one in addFloorToSubscription
- **File**: `lib/subscription-manager.ts:178`
- **Before**: `quantity: sub.floorsActive + 1, // +1 because DB was just incremented`
- **After**: `quantity: sub.floorsActive, // DB was already incremented above`
- **Why**: The DB increment happens on line 146. `getSubscription()` on line 161 reads the ALREADY-incremented value. Adding +1 again sets the wrong quantity.

## FIX-2-03: Add periodic cleanup to swarm-cache
- **File**: `lib/swarm-cache.ts`
- **Before**: No cleanup mechanism for expired entries.
- **After**: Added `ensureCleanup()` with 60s interval timer that deletes expired entries. Timer is unref'd to not keep Node.js alive. Called from `cacheSet()`.

## FIX-2-04: Add session auth to snapshots route
- **File**: `app/api/floors/[floorId]/snapshots/route.ts`
- **Before**: No authentication check.
- **After**: Added `getServerSession(authOptions)` check at the start of the handler. Returns 401 if no session.

## FIX-2-05: Add rate limiting to expand route
- **File**: `app/api/goals/[id]/expand/route.ts`
- **Before**: No rate limiting (auth was already added by Beta).
- **After**: Added `checkRateLimit('expand:${ip}', 5, 3600000)` -- 5 expansions per hour per IP.

## FIX-2-06: Return 503 for DB errors in logs route
- **File**: `app/api/goals/[id]/logs/route.ts:121`
- **Before**: `return NextResponse.json({ logs: [] })` (HTTP 200)
- **After**: `return NextResponse.json({ error: 'Database unavailable', logs: [] }, { status: 503 })`
- **Why**: Callers can now distinguish "no logs" (200) from "DB down" (503).

## FIX-2-07: Add 10s timeout to chainNextStep fetch
- **File**: `lib/step-runner.ts:291`
- **Before**: Bare `fetch()` with no timeout.
- **After**: Added `AbortController` with 10s timeout. `AbortError` is handled gracefully with a log message (expected on Vercel where the request spawns a new function).

## FIX-2-08: Add 10-minute cooldown to stall recovery
- **File**: `lib/heartbeat.ts`
- **Before**: No cooldown -- stalled floors restarted every heartbeat cycle (5 min).
- **After**: Added `stallRecoveryTimestamps` Map tracking last restart per floor. Skips restart if less than 10 minutes since last attempt. Timestamp recorded BEFORE restart to prevent race conditions.

## FIX-2-09: Add session auth to approve route
- **File**: `app/api/goals/[id]/approve/route.ts`
- **Before**: No authentication check.
- **After**: Added `getServerSession(authOptions)` check at the start. Returns 401 if no session. Imported `getServerSession` from `next-auth` and `authOptions` from `@/lib/auth`.

## FIX-2-10: Add 30s timeout to scraper extraction calls
- **File**: `lib/daily-scraper.ts:145`
- **Before**: `await routeAgentCall({...})` with no timeout.
- **After**: `await Promise.race([routeAgentCall({...}), new Promise((_, reject) => setTimeout(() => reject(...), 30_000))])` -- 30s per extraction call. The outer catch already returns `[]` on failure.
