/**
 * Steven's Heartbeat — Phase 5 of AskElira 2.1
 *
 * Monitors live floors, checks health, escalates failures.
 * Steven NEVER crashes the heartbeat cycle. All errors are caught and logged.
 */

import {
  STEVEN_HEARTBEAT_PROMPT,
  STEVEN_ESCALATION_PROMPT,
  ELIRA_ESCALATION_PROMPT,
  ELIRA_EXPANSION_PROMPT,
} from './agent-prompts';

import { callClaudeWithSystem } from './openclaw-client';
import { routeAgentCall } from './agent-router';
import { notify } from './notify';

import {
  type Floor,
  type AgentLog,
  type HeartbeatLog,
  getFloor,
  getGoal,
  getLiveFloors,
  getAllFloors,
  getInProgressFloors,
  getLastAgentLogTime,
  getRecentHeartbeats,
  getRecentLogs,
  logAgentAction,
  logHeartbeat,
  updateFloorStatus,
  updateGoalStatus,
  resetFloor,
  saveStevenSuggestion,
} from './building-manager';

import { chainNextStep } from './step-runner';
import { BUILDING_EVENTS } from './events';
import { getInternalBaseUrl, fetchWithRetry } from './internal-fetch';

// ============================================================
// Types
// ============================================================

export interface StevenResult {
  conditionMet: boolean;
  healthStatus: 'healthy' | 'degraded' | 'broken';
  observation: string;
  action: 'healthy' | 'rerun' | 'escalate';
  suggestedNextAutomation: string | null;
  consecutiveFailures: number;
}

interface StevenEscalationResult {
  floorId: string;
  floorName: string;
  failureCount: number;
  pattern: string;
  lastError: string;
  recommendation: 'patch' | 'rebuild' | 'replan';
  reasoning: string;
}

interface EliraEscalationResult {
  verdict: 'patch' | 'rebuild' | 'replan' | 'pause';
  reasoning: string;
  instructions: string;
}

export interface HeartbeatStatus {
  goalId: string;
  active: boolean;
  intervalMs: number;
  liveFloors: number;
  lastCheckedAt: Date | null;
  nextCheckAt: Date | null;
}

// ============================================================
// Registry — module-level, in-memory only
// ============================================================

interface HeartbeatEntry {
  goalId: string;
  intervalMs: number;
  timer: ReturnType<typeof setInterval>;
  liveFloors: number;
  lastCheckedAt: Date | null;
  nextCheckAt: Date | null;
  consecutiveHealthyChecks: number;
}

const heartbeatRegistry = new Map<string, HeartbeatEntry>();

// ============================================================
// Event emitter (same pattern as building-loop.ts)
// ============================================================

function emitEvent(event: string, data: unknown): void {
  try {
    console.log(`[EVENT] ${event}`, JSON.stringify(data));
  } catch (e) {
    console.error('Event emit failed:', event, e);
  }
}

// ============================================================
// JSON parser — strips markdown fences, throws with context
// ============================================================

function parseJSON<T>(raw: string, agentName: string): T {
  let text = raw.trim();

  // Strip markdown code fences if present (even if preceded by text)
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  } else if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\n?/, '');
    text = text.replace(/\n?```\s*$/, '');
    text = text.trim();
  }

  // Attempt 1: parse directly
  try {
    return JSON.parse(text) as T;
  } catch {
    // Attempt 2: find the first { or [ and parse from there
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let startIdx = -1;

    if (firstBrace >= 0 && firstBracket >= 0) {
      startIdx = Math.min(firstBrace, firstBracket);
    } else if (firstBrace >= 0) {
      startIdx = firstBrace;
    } else if (firstBracket >= 0) {
      startIdx = firstBracket;
    }

    if (startIdx > 0) {
      const substring = text.slice(startIdx);
      try {
        return JSON.parse(substring) as T;
      } catch {
        // fall through to final error
      }
    }

    // Attempt 3: find last } or ] and parse the substring
    if (startIdx >= 0) {
      const closingBrace = text.lastIndexOf('}');
      const closingBracket = text.lastIndexOf(']');
      const endIdx = Math.max(closingBrace, closingBracket);
      if (endIdx > startIdx) {
        const substring = text.slice(startIdx, endIdx + 1);
        try {
          return JSON.parse(substring) as T;
        } catch {
          // fall through to final error
        }
      }
    }

    throw new Error(
      `[${agentName}] Failed to parse JSON response.\n\nRaw (first 2000 chars):\n${raw.slice(0, 2000)}`,
    );
  }
}

// ============================================================
// Message builders
// ============================================================

function buildStevenMessage(
  floor: Floor,
  recentLogs: AgentLog[],
  recentHeartbeats: HeartbeatLog[],
): string {
  const parts: string[] = [
    `FLOOR ${floor.floorNumber}: ${floor.name}`,
    `Status: ${floor.status}`,
    `Success Condition: ${floor.successCondition}`,
    `Description: ${floor.description ?? 'No description'}`,
    '',
    'RECENT AGENT LOGS (last 5):',
  ];

  if (recentLogs.length === 0) {
    parts.push('  (none)');
  } else {
    for (const log of recentLogs) {
      parts.push(
        `  [${log.agentName}] ${log.action} — ${log.outputSummary?.slice(0, 200) ?? 'no output'}`,
      );
    }
  }

  parts.push('', 'RECENT HEARTBEATS (last 3):');

  if (recentHeartbeats.length === 0) {
    parts.push('  (none — first check)');
  } else {
    for (const hb of recentHeartbeats) {
      parts.push(
        `  [${hb.checkedAt.toISOString()}] conditionMet=${hb.conditionMet} action=${hb.actionTaken ?? 'unknown'} observation="${hb.stevenObservation ?? ''}"`,
      );
    }
  }

  if (floor.buildOutput) {
    parts.push('', 'BUILD OUTPUT (summary):');
    try {
      const parsed = JSON.parse(floor.buildOutput);
      const entry = parsed.entryPoint ?? 'unknown';
      const fileNames = Array.isArray(parsed.files)
        ? parsed.files.map((f: { name?: string }) => f.name || 'unknown').join(', ')
        : null;
      const syntaxStatus = parsed.syntaxValid === true ? 'yes' : parsed.syntaxValid === false ? 'NO' : 'unchecked';
      parts.push(`  Entry: ${entry}`);
      if (fileNames) parts.push(`  Files: ${fileNames}`);
      parts.push(`  Syntax Valid: ${syntaxStatus}`);
      parts.push(`  Handoff: ${parsed.handoffNotes ?? 'none'}`);
    } catch {
      parts.push(`  (raw, first 500 chars): ${floor.buildOutput.slice(0, 500)}`);
    }
  }

  // System status — gateway, search, routing
  parts.push('', 'SYSTEM STATUS:');
  const routingMode = process.env.AGENT_ROUTING_MODE || 'gateway';
  const searchProvider = process.env.SEARCH_PROVIDER || 'auto';
  parts.push(`  Agent Routing: ${routingMode}`);
  parts.push(`  Search Provider: ${searchProvider}`);

  try {
    const { getGatewayClient } = require('./gateway-client');
    const gwClient = getGatewayClient();
    if (gwClient) {
      parts.push(`  Gateway: ${gwClient.getStatus()}`);
      const gwMetrics = gwClient.getMetrics();
      parts.push(`  Gateway Requests: ${gwMetrics.requestsViaGateway} (${gwMetrics.gatewaySuccesses} ok, ${gwMetrics.gatewayFailures} fail)`);
    } else {
      parts.push('  Gateway: not configured');
    }
  } catch {
    parts.push('  Gateway: unavailable');
  }

  try {
    const { getRoutingMetrics } = require('./agent-router');
    const routeMetrics = getRoutingMetrics();
    parts.push(`  Direct API Requests: ${routeMetrics.directRequests} (${routeMetrics.directSuccesses} ok, ${routeMetrics.directFailures} fail)`);
    parts.push(`  Fallbacks Used: ${routeMetrics.fallbacksUsed}`);
  } catch {
    // agent-router not available
  }

  return parts.join('\n');
}

function buildEscalationMessage(
  floor: Floor,
  stevenResult: StevenResult,
  failureCount: number,
): string {
  return [
    `FLOOR ${floor.floorNumber}: ${floor.name}`,
    `Floor ID: ${floor.id}`,
    `Success Condition: ${floor.successCondition}`,
    `Current Status: ${floor.status}`,
    '',
    `FAILURE COUNT: ${failureCount}`,
    `STEVEN'S LAST OBSERVATION: ${stevenResult.observation}`,
    `HEALTH STATUS: ${stevenResult.healthStatus}`,
    '',
    'Provide your escalation report.',
  ].join('\n');
}

// ============================================================
// Public exports
// ============================================================

/**
 * Start the heartbeat cycle for a goal. Idempotent — calling again is a no-op.
 */
export function startHeartbeat(goalId: string, intervalMs?: number): void {
  if (heartbeatRegistry.has(goalId)) {
    console.log(`[Heartbeat] Already running for goal ${goalId}`);
    return;
  }

  const interval = intervalMs ?? 300_000; // default 5 minutes
  const now = new Date();

  console.log(`[Heartbeat] Starting for goal ${goalId} with interval ${interval}ms`);
  notify(`🫀 *Heartbeat started* for goal \`${goalId}\` (every ${Math.round(interval / 1000)}s)`);

  const timer = setInterval(() => {
    runHeartbeatCycle(goalId);
  }, interval);

  // Also run immediately on start
  setImmediate(() => {
    runHeartbeatCycle(goalId);
  });

  heartbeatRegistry.set(goalId, {
    goalId,
    intervalMs: interval,
    timer,
    liveFloors: 0,
    lastCheckedAt: null,
    nextCheckAt: new Date(now.getTime() + interval),
    consecutiveHealthyChecks: 0,
  });
}

/**
 * Stop the heartbeat cycle for a goal.
 */
export function stopHeartbeat(goalId: string): void {
  const entry = heartbeatRegistry.get(goalId);
  if (!entry) {
    console.log(`[Heartbeat] No heartbeat running for goal ${goalId}`);
    return;
  }

  clearInterval(entry.timer);
  heartbeatRegistry.delete(goalId);
  console.log(`[Heartbeat] Stopped for goal ${goalId}`);
}

/**
 * Check a single floor's health. Used by the heartbeat cycle and externally.
 */
export async function checkFloor(floorId: string): Promise<StevenResult> {
  const floor = await getFloor(floorId);
  if (!floor) {
    throw new Error(`[Heartbeat] Floor not found: ${floorId}`);
  }

  // Load recent logs for this floor (last 5)
  const allLogs = await getRecentLogs(floor.goalId, 50);
  const floorLogs = allLogs
    .filter((l) => l.floorId === floorId)
    .slice(0, 5);

  // Load recent heartbeats (last 3)
  const recentHeartbeats = await getRecentHeartbeats(floorId, 3);

  // Build the message for Steven
  const stevenMessage = buildStevenMessage(floor, floorLogs, recentHeartbeats);

  const startTime = Date.now();

  // Call Steven (Sonnet only — never Opus)
  const raw = await routeAgentCall({
    systemPrompt: STEVEN_HEARTBEAT_PROMPT,
    userMessage: stevenMessage,
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 1024,
    agentName: 'Steven',
  });

  const result = parseJSON<StevenResult>(raw, 'Steven');
  const durationMs = Date.now() - startTime;

  // Log heartbeat to DB
  await logHeartbeat({
    floorId,
    goalId: floor.goalId,
    conditionMet: result.conditionMet,
    stevenObservation: result.observation,
    actionTaken: result.action,
  });

  // Log agent action
  await logAgentAction({
    floorId,
    goalId: floor.goalId,
    agentName: 'Steven',
    action: `heartbeat_${result.action}`,
    inputSummary: `Floor ${floor.floorNumber}: ${floor.name}`,
    outputSummary: result.observation.slice(0, 2000),
    durationMs,
  });

  // Step 7 — Save suggestion if present
  if (result.suggestedNextAutomation) {
    try {
      await saveStevenSuggestion(
        floor.goalId,
        floorId,
        result.suggestedNextAutomation,
      );
    } catch (err) {
      console.error(`[Heartbeat] Failed to save suggestion:`, err);
    }
  }

  // Emit heartbeat event
  emitEvent(BUILDING_EVENTS.HEARTBEAT, {
    floorId,
    goalId: floor.goalId,
    floorNumber: floor.floorNumber,
    name: floor.name,
    ...result,
  });

  // Route by action
  if (result.action === 'rerun') {
    await handleRerun(floor, result);
  } else if (result.action === 'escalate') {
    await handleEscalation(floor, result);
  } else {
    // healthy
    emitEvent(BUILDING_EVENTS.FLOOR_HEALTHY, {
      floorId,
      goalId: floor.goalId,
      floorNumber: floor.floorNumber,
    });
  }

  return result;
}

/**
 * Get the current heartbeat status for a goal.
 */
export function getHeartbeatStatus(goalId: string): HeartbeatStatus {
  const entry = heartbeatRegistry.get(goalId);

  if (!entry) {
    return {
      goalId,
      active: false,
      intervalMs: 0,
      liveFloors: 0,
      lastCheckedAt: null,
      nextCheckAt: null,
    };
  }

  return {
    goalId,
    active: true,
    intervalMs: entry.intervalMs,
    liveFloors: entry.liveFloors,
    lastCheckedAt: entry.lastCheckedAt,
    nextCheckAt: entry.nextCheckAt,
  };
}

// ============================================================
// Private: heartbeat cycle
// ============================================================

async function runHeartbeatCycle(goalId: string): Promise<void> {
  // Steven NEVER crashes from runHeartbeatCycle
  try {
    console.log(`[Heartbeat] Running cycle for goal ${goalId}`);

    const entry = heartbeatRegistry.get(goalId);
    if (!entry) {
      console.log(`[Heartbeat] Goal ${goalId} no longer in registry, skipping`);
      return;
    }

    // Phase 9: Billing gate — check subscription status before proceeding
    if (!process.env.STRIPE_SECRET_KEY) {
      // Dev mode — no billing, allow through
    } else {
      try {
        const { getSubscription, updateSubscriptionStatus } = await import(
          './subscription-manager'
        );
        const sub = await getSubscription(goalId);
        if (sub) {
          if (
            sub.status === 'past_due' &&
            sub.gracePeriodEnd &&
            new Date() > sub.gracePeriodEnd
          ) {
            // Grace period expired — pause everything
            console.log(`[Heartbeat] Grace period expired for goal ${goalId} — pausing`);
            await updateSubscriptionStatus(goalId, 'paused');
            stopHeartbeat(goalId);
            return;
          }
          if (sub.status === 'paused' || sub.status === 'canceled') {
            console.log(`[Heartbeat] Subscription ${sub.status} for goal ${goalId} — stopping`);
            stopHeartbeat(goalId);
            return;
          }
        }
      } catch (billingErr) {
        // Billing check failed — allow through, never block on billing errors
        console.error(`[Heartbeat] Billing gate error (allowing through):`, billingErr);
      }
    }

    // Check for stalled floors (researching/building/auditing with no activity)
    // This runs BEFORE the live floor check because stalled floors are not "live"
    // and would otherwise be invisible to the heartbeat.
    try {
      await checkStalledFloors(goalId);
    } catch (err) {
      console.error(`[Heartbeat] Stall check failed for ${goalId}:`, err);
      // Non-fatal — continue with live floor checks
    }

    // Load live floors
    let liveFloors: Floor[];
    try {
      liveFloors = await getLiveFloors(goalId);
    } catch (err) {
      console.error(`[Heartbeat] Failed to load live floors for ${goalId}:`, err);
      return;
    }

    entry.liveFloors = liveFloors.length;
    entry.lastCheckedAt = new Date();
    entry.nextCheckAt = new Date(Date.now() + entry.intervalMs);

    if (liveFloors.length === 0) {
      console.log(`[Heartbeat] No live floors for goal ${goalId}`);
      return;
    }

    console.log(`[Heartbeat] Checking ${liveFloors.length} live floor(s) for goal ${goalId}`);

    let allHealthy = true;

    // Check each live floor individually — failures don't crash the cycle
    for (const floor of liveFloors) {
      try {
        const result = await checkFloor(floor.id);
        if (result.action !== 'healthy') {
          allHealthy = false;
        }
      } catch (err) {
        console.error(
          `[Heartbeat] Error checking floor ${floor.id} (${floor.name}):`,
          err,
        );
        allHealthy = false;
        // Continue to next floor — don't crash the cycle
      }
    }

    // Track consecutive healthy checks for expansion detection
    if (allHealthy && liveFloors.length > 0) {
      entry.consecutiveHealthyChecks++;

      // If all floors healthy, check goal completion
      try {
        await checkGoalCompletion(goalId);
      } catch (err) {
        console.error(`[Heartbeat] Goal completion check failed for ${goalId}:`, err);
      }

      // After 3+ consecutive healthy cycles, check expansion opportunity
      if (entry.consecutiveHealthyChecks >= 3) {
        try {
          await checkExpansionOpportunity(goalId);
        } catch (err) {
          console.error(`[Heartbeat] Expansion check failed for ${goalId}:`, err);
        }
      }
    } else {
      // Reset consecutive healthy count on any non-healthy cycle
      entry.consecutiveHealthyChecks = 0;
    }
  } catch (outerErr) {
    // Absolute last resort catch — Steven NEVER crashes
    console.error(`[Heartbeat] CRITICAL: Outer error in heartbeat cycle for ${goalId}:`, outerErr);
  }
}

// ============================================================
// Private: action handlers
// ============================================================

async function handleRerun(floor: Floor, result: StevenResult): Promise<void> {
  console.log(`[Heartbeat] Rerun triggered for floor ${floor.id} (${floor.name})`);

  // Check consecutive failures from recent heartbeats
  const recentHeartbeats = await getRecentHeartbeats(floor.id, 5);
  const consecutiveFailures = countConsecutiveFailures(recentHeartbeats);

  if (consecutiveFailures >= 3) {
    console.log(
      `[Heartbeat] ${consecutiveFailures} consecutive failures for floor ${floor.id} — escalating`,
    );
    await handleEscalation(floor, {
      ...result,
      action: 'escalate',
      consecutiveFailures,
    });
    return;
  }

  // Snapshot floor state before resetting (Phase 10: versioning)
  try {
    const { snapshotFloor } = await import('./building-manager');
    await snapshotFloor(floor.id, `rerun: ${result.observation.slice(0, 200)}`);
  } catch (snapErr) {
    console.error(`[Heartbeat] snapshotFloor failed for ${floor.id}:`, snapErr);
    // Non-fatal — continue with rerun
  }

  // Mark floor as broken, then re-trigger the loop
  await updateFloorStatus(floor.id, 'broken');

  emitEvent(BUILDING_EVENTS.FLOOR_BROKEN, {
    floorId: floor.id,
    goalId: floor.goalId,
    floorNumber: floor.floorNumber,
    reason: result.observation,
  });

  // Reset floor to pending so step runner can process it
  await resetFloor(floor.id);

  // Trigger step-based re-run
  chainNextStep(floor.id, 'alba', 1).catch((err) => {
    console.error(`[Heartbeat] Step chain failed for ${floor.id}:`, err);
  });
}

async function handleEscalation(
  floor: Floor,
  result: StevenResult,
): Promise<void> {
  console.log(`[Heartbeat] Escalation for floor ${floor.id} (${floor.name})`);

  const recentHeartbeats = await getRecentHeartbeats(floor.id, 10);
  const failureCount = countConsecutiveFailures(recentHeartbeats);

  // Step 1: Steven creates escalation report
  const escalationMessage = buildEscalationMessage(floor, result, failureCount);

  let stevenEscalation: StevenEscalationResult;
  try {
    const stevenRaw = await routeAgentCall({
      systemPrompt: STEVEN_ESCALATION_PROMPT,
      userMessage: escalationMessage,
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 1024,
      agentName: 'Steven',
    });
    stevenEscalation = parseJSON<StevenEscalationResult>(stevenRaw, 'Steven-Escalation');
  } catch (err) {
    console.error(`[Heartbeat] Steven escalation failed:`, err);
    // Mark floor blocked as fallback
    await updateFloorStatus(floor.id, 'blocked');
    return;
  }

  await logAgentAction({
    floorId: floor.id,
    goalId: floor.goalId,
    agentName: 'Steven',
    action: 'escalation_report',
    outputSummary: JSON.stringify(stevenEscalation).slice(0, 2000),
  });

  // Step 2: Elira receives escalation
  let eliraVerdict: EliraEscalationResult;
  try {
    const eliraRaw = await routeAgentCall({
      systemPrompt: ELIRA_ESCALATION_PROMPT,
      userMessage: JSON.stringify(stevenEscalation, null, 2),
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 1024,
      agentName: 'Elira',
    });
    eliraVerdict = parseJSON<EliraEscalationResult>(eliraRaw, 'Elira-Escalation');
  } catch (err) {
    console.error(`[Heartbeat] Elira escalation failed:`, err);
    await updateFloorStatus(floor.id, 'blocked');
    return;
  }

  await logAgentAction({
    floorId: floor.id,
    goalId: floor.goalId,
    agentName: 'Elira',
    action: 'escalation_verdict',
    outputSummary: JSON.stringify(eliraVerdict).slice(0, 2000),
  });

  console.log(`[Heartbeat] Elira verdict: ${eliraVerdict.verdict} — ${eliraVerdict.reasoning}`);

  // Route by verdict
  switch (eliraVerdict.verdict) {
    case 'patch':
      // Route back through the loop with instructions
      await resetFloor(floor.id);
      chainNextStep(floor.id, 'alba', 1).catch((err) => {
        console.error(`[Heartbeat] Patch step chain failed for ${floor.id}:`, err);
      });
      break;

    case 'rebuild':
      // Full reset and rebuild
      await resetFloor(floor.id);
      chainNextStep(floor.id, 'alba', 1).catch((err) => {
        console.error(`[Heartbeat] Rebuild step chain failed for ${floor.id}:`, err);
      });
      break;

    case 'replan':
      // Mark blocked — replan requires human or Floor 0 re-run
      await updateFloorStatus(floor.id, 'blocked');
      await logAgentAction({
        floorId: floor.id,
        goalId: floor.goalId,
        agentName: 'System',
        action: 'replan_required',
        outputSummary: eliraVerdict.instructions,
      });
      break;

    case 'pause':
      // Too risky to auto-fix — mark blocked and notify
      await updateFloorStatus(floor.id, 'blocked');
      await updateGoalStatus(floor.goalId, 'blocked');
      await logAgentAction({
        floorId: floor.id,
        goalId: floor.goalId,
        agentName: 'System',
        action: 'paused_by_elira',
        outputSummary: eliraVerdict.instructions,
      });
      break;

    default:
      console.error(`[Heartbeat] Unknown Elira verdict: ${eliraVerdict.verdict}`);
      await updateFloorStatus(floor.id, 'blocked');
  }
}

// ============================================================
// Private: goal completion check
// ============================================================

async function checkGoalCompletion(goalId: string): Promise<void> {
  const allFloors = await getAllFloors(goalId);

  if (allFloors.length === 0) return;

  const allLive = allFloors.every((f) => f.status === 'live');

  if (allLive) {
    // Verify all conditions met via recent heartbeats
    let allConditionsMet = true;
    for (const floor of allFloors) {
      const heartbeats = await getRecentHeartbeats(floor.id, 1);
      if (heartbeats.length === 0 || !heartbeats[0].conditionMet) {
        allConditionsMet = false;
        break;
      }
    }

    if (allConditionsMet) {
      console.log(`[Heartbeat] All floors live and conditions met — goal ${goalId} complete`);
      await updateGoalStatus(goalId, 'goal_met');

      emitEvent(BUILDING_EVENTS.GOAL_MET, { goalId });

      // Save as template for future reuse (Phase 10)
      try {
        const { saveAsTemplate } = await import('./building-manager');
        await saveAsTemplate(goalId);
      } catch (tmplErr) {
        console.error(`[Heartbeat] saveAsTemplate failed for ${goalId}:`, tmplErr);
        // Non-fatal — never crash for template saving
      }

      // Stop the heartbeat since goal is met
      stopHeartbeat(goalId);
    }
  }
}

// ============================================================
// Private: utility
// ============================================================

function countConsecutiveFailures(heartbeats: HeartbeatLog[]): number {
  // Heartbeats are ordered DESC by checked_at
  let count = 0;
  for (const hb of heartbeats) {
    if (!hb.conditionMet) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ============================================================
// Private: stall recovery — detect and restart stuck floors
// ============================================================

const STALL_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const STALL_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes between restart attempts per floor
const stallRecoveryTimestamps = new Map<string, number>();

// Periodically clean up stale recovery timestamps (older than 1 hour)
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, ts] of stallRecoveryTimestamps) {
    if (ts < cutoff) stallRecoveryTimestamps.delete(key);
  }
}, 15 * 60 * 1000).unref();

/**
 * Check for floors stuck in researching/building/auditing with no recent
 * agent activity. Floors in these statuses should have continuous agent
 * logs. If no log has been written for >5 minutes, the build chain likely
 * stalled (e.g., continuation fetch failed, waitUntil no-op, cold start
 * timeout). Restart by calling the loop/step endpoint.
 */
async function checkStalledFloors(goalId: string): Promise<void> {
  let inProgressFloors: Floor[];
  try {
    inProgressFloors = await getInProgressFloors(goalId);
  } catch (err) {
    console.error(`[Heartbeat] Failed to load in-progress floors for ${goalId}:`, err);
    return;
  }

  if (inProgressFloors.length === 0) return;

  const now = Date.now();

  for (const floor of inProgressFloors) {
    try {
      // Cooldown: skip if we already attempted a restart recently
      const lastRestart = stallRecoveryTimestamps.get(floor.id);
      if (lastRestart && (now - lastRestart) < STALL_COOLDOWN_MS) {
        continue;
      }

      const lastLogTime = await getLastAgentLogTime(floor.id);

      // If there's no log at all, use createdAt as the reference time
      const referenceTime = lastLogTime ?? floor.createdAt;
      const stalledMs = now - referenceTime.getTime();

      if (stalledMs < STALL_THRESHOLD_MS) {
        // Floor is still making progress
        continue;
      }

      console.log(
        `[Heartbeat] STALL DETECTED: Floor ${floor.floorNumber} "${floor.name}" (${floor.id}) ` +
        `stuck in "${floor.status}" for ${Math.round(stalledMs / 1000)}s with no agent activity`,
      );

      // Record the restart attempt timestamp before restarting
      stallRecoveryTimestamps.set(floor.id, now);

      // Log the stall detection
      await logAgentAction({
        floorId: floor.id,
        goalId: floor.goalId,
        agentName: 'Steven',
        action: 'stall_detected',
        outputSummary: `Floor stalled in "${floor.status}" for ${Math.round(stalledMs / 1000)}s. Restarting build chain.`,
      });

      // Determine which step to restart from based on floor state
      let restartStep = 'alba';
      const iteration = floor.iterationCount || 1;

      if (floor.status === 'auditing' && floor.buildOutput) {
        restartStep = 'vex2';
      } else if (floor.status === 'building' && floor.vexGate1Report) {
        restartStep = 'david';
      } else if (floor.status === 'researching' && floor.researchOutput) {
        restartStep = 'vex1';
      }

      // Restart via internal API call (with retry)
      const baseUrl = getInternalBaseUrl();
      const restartUrl = `${baseUrl}/api/loop/step/${floor.id}?step=${restartStep}&iteration=${iteration}`;
      console.log(`[Heartbeat] Restarting stalled floor: ${restartUrl}`);

      await fetchWithRetry({ url: restartUrl, tag: 'Heartbeat/stall-recovery' });

      emitEvent(BUILDING_EVENTS.FLOOR_BROKEN, {
        floorId: floor.id,
        goalId: floor.goalId,
        floorNumber: floor.floorNumber,
        reason: `Stall recovery: floor stuck in "${floor.status}" for ${Math.round(stalledMs / 1000)}s`,
      });
    } catch (err) {
      console.error(
        `[Heartbeat] Stall recovery failed for floor ${floor.id} (${floor.name}):`,
        err,
      );
      // Continue to next floor — never crash the cycle
    }
  }
}

// ============================================================
// Private: expansion opportunity detection (Phase 10)
// ============================================================

interface EliraExpansionResult {
  shouldExpand: boolean;
  reasoning: string;
  floor: {
    name: string;
    description: string;
    successCondition: string;
  } | null;
}

async function checkExpansionOpportunity(goalId: string): Promise<void> {
  console.log(`[Heartbeat] Checking expansion opportunity for goal ${goalId}`);

  // Load last 10 Steven suggestions
  const { getStevenSuggestions } = await import('./building-manager');
  const suggestions = await getStevenSuggestions(goalId);
  const recentSuggestions = suggestions.slice(0, 10);

  if (recentSuggestions.length < 3) {
    return; // Not enough suggestions to detect a pattern
  }

  // Group suggestions by similarity using keyword overlap.
  // Exact string matching after lowercase/trim is too strict -- Steven's
  // suggestions will always vary slightly in wording. We use word-set
  // overlap (Jaccard similarity >= 0.6) to cluster similar suggestions.
  function getWords(text: string): Set<string> {
    return new Set(
      text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2)
    );
  }

  function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    let intersection = 0;
    for (const w of a) {
      if (b.has(w)) intersection++;
    }
    return intersection / (a.size + b.size - intersection);
  }

  // Cluster suggestions: group similar ones together
  const clusters: Array<{ representative: string; count: number }> = [];
  const wordSets = recentSuggestions.map(s => ({ text: s, words: getWords(s) }));

  for (const item of wordSets) {
    let matched = false;
    for (const cluster of clusters) {
      const clusterWords = getWords(cluster.representative);
      if (jaccardSimilarity(item.words, clusterWords) >= 0.6) {
        cluster.count++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({ representative: item.text, count: 1 });
    }
  }

  // Find clusters appearing 3+ times
  const repeatedSuggestions: string[] = [];
  for (const cluster of clusters) {
    if (cluster.count >= 3) {
      repeatedSuggestions.push(cluster.representative);
    }
  }

  if (repeatedSuggestions.length === 0) {
    return; // No recurring pattern
  }

  console.log(`[Heartbeat] Found ${repeatedSuggestions.length} repeated suggestion(s) for goal ${goalId}`);

  // Call Elira to evaluate expansion
  const userMessage = [
    `GOAL ID: ${goalId}`,
    '',
    'REPEATED AUTOMATION SUGGESTIONS FROM STEVEN:',
    ...repeatedSuggestions.map((s, i) => `${i + 1}. ${s}`),
    '',
    'Evaluate whether the building should be expanded with a new floor based on these recurring suggestions.',
  ].join('\n');

  try {
    const raw = await routeAgentCall({
      systemPrompt: ELIRA_EXPANSION_PROMPT,
      userMessage,
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 1024,
      agentName: 'Elira',
    });

    const result = parseJSON<EliraExpansionResult>(raw, 'Elira-Expansion');

    // Log the expansion evaluation
    await logAgentAction({
      goalId,
      agentName: 'Elira',
      action: 'expansion_evaluated',
      inputSummary: `${repeatedSuggestions.length} repeated suggestion(s)`,
      outputSummary: JSON.stringify(result).slice(0, 2000),
    });

    if (result.shouldExpand && result.floor) {
      // Log the expansion suggestion
      await logAgentAction({
        goalId,
        agentName: 'Elira',
        action: 'expansion_suggested',
        outputSummary: JSON.stringify(result.floor).slice(0, 2000),
      });

      emitEvent(BUILDING_EVENTS.EXPANSION_SUGGESTED, {
        goalId,
        floor: result.floor,
        reasoning: result.reasoning,
      });

      console.log(`[Heartbeat] Expansion suggested for goal ${goalId}: "${result.floor.name}"`);
    }
  } catch (err) {
    console.error(`[Heartbeat] Elira expansion call failed for ${goalId}:`, err);
    // Non-fatal — never crash the heartbeat
  }
}
