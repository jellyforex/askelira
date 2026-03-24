/**
 * Building Loop Engine — Phase 4 of AskElira 2.1
 *
 * Runs a single floor through the full agent loop:
 *   Alba (research) -> Vex Gate 1 -> David (build) -> Vex Gate 2 -> Elira (review)
 *
 * Each iteration retries on rejection. Max 5 iterations per floor.
 */

import {
  ALBA_RESEARCH_PROMPT,
  VEX_GATE1_PROMPT,
  DAVID_BUILD_PROMPT,
  VEX_GATE2_PROMPT,
  ELIRA_FLOOR_REVIEW_PROMPT,
} from './agent-prompts';

import { callClaudeWithTools, callClaudeWithSystem } from './openclaw-client';
import { routeAgentCall } from './agent-router';

import {
  type Floor,
  type Goal,
  getFloor,
  getGoal,
  getBuildingContext,
  incrementIteration,
  updateFloorStatus,
  updateGoalStatus,
  logAgentAction,
  getPriorVex2Reports,
  getNextFloor,
} from './building-manager';

import { BUILDING_EVENTS } from './events';
import { notify } from './notify';
import { type DavidResult, normalizeDavidResult, serializeDavidResult } from './shared-types';
import { validateSyntax } from './syntax-validator';

import {
  detectCategory,
  getTopPatterns,
  recordPatternSuccess,
  recordPatternFailure,
  saveCustomerBuildPattern,
  type AutomationPattern,
} from './pattern-manager';

// ============================================================
// Constants
// ============================================================

const MAX_ITERATIONS = 5;

// ============================================================
// Types for agent outputs
// ============================================================

interface AlbaResult {
  approach: string;
  implementation: string;
  libraries: string[];
  risks: string[];
  sources: string[];
  complexity: number;
}

interface VexGate1Result {
  approved: boolean;
  verdict: string;
  issues: string[];
  requiredChanges: string[];
  confidenceScore: number;
}

// DavidResult imported from './shared-types'

interface VexGate2Result {
  approved: boolean;
  verdict: string;
  issues: string[];
  specificFixes: string[];
  qualityScore: number;
}

interface EliraReviewResult {
  verdict: 'approved' | 'not_ready';
  reason: string;
  goalOnTrack: boolean;
  nextFloorReady: boolean;
}

// ============================================================
// Event emitter — no Socket.io in codebase, uses console.log
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

function buildAlbaMessage(
  floor: Floor,
  buildingContext: string,
  goal: Goal,
  priorVex1Report?: string,
  existingPatterns?: AutomationPattern[],
): string {
  const parts: string[] = [
    `FLOOR ${floor.floorNumber}: ${floor.name}`,
    `Description: ${floor.description ?? 'No description'}`,
    `Success Condition: ${floor.successCondition}`,
    '',
    `CUSTOMER GOAL: ${goal.goalText}`,
    '',
    `BUILDING CONTEXT (prior floors):`,
    buildingContext,
  ];

  if (existingPatterns && existingPatterns.length > 0) {
    parts.push(
      '',
      'PROVEN AUTOMATION PATTERNS (from intelligence database):',
    );
    for (const p of existingPatterns) {
      parts.push(
        `- [${Math.round(p.confidence * 100)}% confidence] ${p.patternDescription}`,
        `  Implementation: ${p.implementationNotes ?? 'N/A'}`,
        `  Source: ${p.sourceUrl ?? 'customer build'}`,
      );
    }
  }

  if (priorVex1Report) {
    parts.push(
      '',
      'PREVIOUS VEX GATE 1 REJECTION (address every issue):',
      priorVex1Report,
    );
  }

  return parts.join('\n');
}

function buildVex1Message(floor: Floor, albaResult: AlbaResult): string {
  return [
    `FLOOR ${floor.floorNumber}: ${floor.name}`,
    `Success Condition: ${floor.successCondition}`,
    '',
    'ALBA RESEARCH REPORT:',
    JSON.stringify(albaResult, null, 2),
  ].join('\n');
}

function buildDavidMessage(
  floor: Floor,
  albaResult: AlbaResult,
  vex1Result: VexGate1Result,
  buildingContext: string,
  priorVex2Reports: string[],
): string {
  const parts: string[] = [
    `FLOOR ${floor.floorNumber}: ${floor.name}`,
    `Description: ${floor.description ?? 'No description'}`,
    `Success Condition: ${floor.successCondition}`,
    '',
    'ALBA RESEARCH (verified sources):',
    JSON.stringify(albaResult, null, 2),
    '',
    'VEX GATE 1 APPROVAL:',
    JSON.stringify(vex1Result, null, 2),
    '',
    'BUILDING CONTEXT (prior floors):',
    buildingContext,
  ];

  if (priorVex2Reports.length > 0) {
    parts.push(
      '',
      'PRIOR VEX GATE 2 REJECTIONS (address each one):',
    );
    for (let i = 0; i < priorVex2Reports.length; i++) {
      parts.push(`Rejection ${i + 1}: ${priorVex2Reports[i]}`);
    }
  }

  return parts.join('\n');
}

function buildVex2Message(
  floor: Floor,
  albaResult: AlbaResult,
  davidResult: DavidResult,
): string {
  return [
    `FLOOR ${floor.floorNumber}: ${floor.name}`,
    `Success Condition: ${floor.successCondition}`,
    '',
    'ALBA RESEARCH REPORT:',
    JSON.stringify(albaResult, null, 2),
    '',
    'DAVID BUILD OUTPUT:',
    JSON.stringify(davidResult, null, 2),
  ].join('\n');
}

function buildEliraReviewMessage(
  floor: Floor,
  davidResult: DavidResult,
  goal: Goal,
  buildingContext: string,
): string {
  return [
    `FLOOR ${floor.floorNumber}: ${floor.name}`,
    `Success Condition: ${floor.successCondition}`,
    '',
    `CUSTOMER GOAL: ${goal.goalText}`,
    '',
    'BUILDING CONTEXT:',
    buildingContext,
    '',
    'DAVID BUILD OUTPUT:',
    JSON.stringify(davidResult, null, 2),
  ].join('\n');
}

// ============================================================
// Public exports
// ============================================================

/**
 * Get a floor by ID (thin wrapper for heartbeat use).
 */
export async function getFloorForHeartbeat(floorId: string): Promise<Floor | null> {
  return getFloor(floorId);
}

/**
 * Run the full building loop for a single floor.
 * Returns 'live' if the floor passed all gates, 'blocked' if max iterations exceeded.
 */
// Maximum recursion depth to prevent stack overflow with many floors
const MAX_FLOOR_DEPTH = 20;

export async function runFloor(floorId: string, _depth: number = 0): Promise<'live' | 'blocked'> {
  if (_depth >= MAX_FLOOR_DEPTH) {
    console.error(`[BuildingLoop] Max recursion depth (${MAX_FLOOR_DEPTH}) reached at floor ${floorId}. Breaking chain.`);
    return 'live'; // Return gracefully; remaining floors will be picked up by heartbeat stall recovery
  }
  console.log(`[BuildingLoop] Starting floor ${floorId}`);

  // Load floor
  const floor = await getFloor(floorId);
  if (!floor) {
    throw new Error(`[BuildingLoop] Floor not found: ${floorId}`);
  }

  // Load goal
  const goalWithFloors = await getGoal(floor.goalId);
  const goal: Goal = {
    id: goalWithFloors.id,
    customerId: goalWithFloors.customerId,
    goalText: goalWithFloors.goalText,
    customerContext: goalWithFloors.customerContext,
    buildingSummary: goalWithFloors.buildingSummary,
    status: goalWithFloors.status,
    createdAt: goalWithFloors.createdAt,
    updatedAt: goalWithFloors.updatedAt,
  };

  // Track state across iterations
  let priorVex1Report: string | undefined;

  // Phase 8: Detect category and fetch proven patterns (once per floor)
  let category: string | null = null;
  let existingPatterns: AutomationPattern[] = [];
  try {
    category = detectCategory(
      floor.name,
      floor.description ?? '',
      floor.successCondition,
    );
    if (category) {
      existingPatterns = await getTopPatterns(category, 3, 0.6);
      if (existingPatterns.length > 0) {
        console.log(`[BuildingLoop] Found ${existingPatterns.length} proven patterns for category "${category}"`);
      }
    }
  } catch {
    // Pattern detection is best-effort — never blocks the loop
  }

  // Main loop
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    console.log(`[BuildingLoop] Floor ${floor.floorNumber} "${floor.name}" — iteration ${iteration}/${MAX_ITERATIONS}`);

    const iterationCount = await incrementIteration(floorId);
    const buildingContext = await getBuildingContext(floor.goalId);

    emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
      floorId,
      goalId: floor.goalId,
      iteration: iterationCount,
      phase: 'loop_start',
    });

    // -------------------------------------------------------
    // A. ALBA RESEARCH
    // -------------------------------------------------------
    console.log(`[BuildingLoop] [${iteration}] Alba researching...`);
    await updateFloorStatus(floorId, 'researching');
    emitEvent(BUILDING_EVENTS.FLOOR_STATUS, { floorId, status: 'researching', iteration });

    const albaStartTime = Date.now();
    const albaMessage = buildAlbaMessage(floor, buildingContext, goal, priorVex1Report, existingPatterns);

    let albaRaw: string;
    try {
      albaRaw = await routeAgentCall({
        systemPrompt: ALBA_RESEARCH_PROMPT,
        userMessage: albaMessage,
        model: 'claude-sonnet-4-5-20250929',
        maxTokens: 4096,
        agentName: 'Alba',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BuildingLoop] Alba failed: ${msg}`);
      notify(`⚠️ *Alba error* on floor ${floor.floorNumber} "${floor.name}"\n\`${msg.slice(0, 200)}\``);
      await logAgentAction({
        floorId,
        goalId: floor.goalId,
        agentName: 'Alba',
        iteration: iterationCount,
        action: 'research_error',
        outputSummary: msg.slice(0, 2000),
        durationMs: Date.now() - albaStartTime,
      });
      // Retry next iteration
      continue;
    }

    const albaResult = parseJSON<AlbaResult>(albaRaw, 'Alba');

    await updateFloorStatus(floorId, 'researching', {
      researchOutput: JSON.stringify(albaResult),
    } as Partial<Floor>);

    await logAgentAction({
      floorId,
      goalId: floor.goalId,
      agentName: 'Alba',
      iteration: iterationCount,
      action: 'research_complete',
      inputSummary: `Floor ${floor.floorNumber}: ${floor.name}`,
      outputSummary: albaResult.approach.slice(0, 2000),
      durationMs: Date.now() - albaStartTime,
    });

    emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
      floorId,
      agent: 'Alba',
      action: 'research_complete',
      iteration: iterationCount,
    });

    // -------------------------------------------------------
    // B. VEX GATE 1
    // -------------------------------------------------------
    console.log(`[BuildingLoop] [${iteration}] Vex Gate 1 auditing research...`);
    await updateFloorStatus(floorId, 'auditing');
    emitEvent(BUILDING_EVENTS.FLOOR_STATUS, { floorId, status: 'auditing', iteration, gate: 1 });

    const vex1StartTime = Date.now();
    const vex1Message = buildVex1Message(floor, albaResult);

    const vex1Raw = await routeAgentCall({
      systemPrompt: VEX_GATE1_PROMPT,
      userMessage: vex1Message,
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 2048,
      agentName: 'Vex1',
    });

    const vex1Result = parseJSON<VexGate1Result>(vex1Raw, 'Vex-Gate1');

    await updateFloorStatus(floorId, 'auditing', {
      vexGate1Report: JSON.stringify(vex1Result),
    } as Partial<Floor>);

    await logAgentAction({
      floorId,
      goalId: floor.goalId,
      agentName: 'Vex',
      iteration: iterationCount,
      action: vex1Result.approved ? 'gate1_approved' : 'gate1_rejected',
      inputSummary: `Research: ${albaResult.approach.slice(0, 500)}`,
      outputSummary: vex1Result.verdict.slice(0, 2000),
      durationMs: Date.now() - vex1StartTime,
    });

    emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
      floorId,
      agent: 'Vex',
      action: vex1Result.approved ? 'gate1_approved' : 'gate1_rejected',
      iteration: iterationCount,
      verdict: vex1Result.verdict,
    });

    if (!vex1Result.approved) {
      console.log(`[BuildingLoop] [${iteration}] Vex Gate 1 REJECTED: ${vex1Result.verdict}`);
      priorVex1Report = JSON.stringify(vex1Result);
      continue; // Back to Alba
    }

    console.log(`[BuildingLoop] [${iteration}] Vex Gate 1 APPROVED`);
    priorVex1Report = undefined; // Clear for next iteration if needed

    // -------------------------------------------------------
    // C. DAVID BUILD
    // -------------------------------------------------------
    console.log(`[BuildingLoop] [${iteration}] David building...`);
    await updateFloorStatus(floorId, 'building');
    emitEvent(BUILDING_EVENTS.FLOOR_STATUS, { floorId, status: 'building', iteration });

    const davidStartTime = Date.now();
    const priorVex2Reports = await getPriorVex2Reports(floorId);
    const davidMessage = buildDavidMessage(floor, albaResult, vex1Result, buildingContext, priorVex2Reports);

    const davidRaw = await routeAgentCall({
      systemPrompt: DAVID_BUILD_PROMPT,
      userMessage: davidMessage,
      model: 'claude-opus-4-5',
      maxTokens: 8192,
      agentName: 'David',
    });

    const davidRawParsed = parseJSON<Record<string, unknown>>(davidRaw, 'David');
    const davidResult = normalizeDavidResult(davidRawParsed);

    // Validate entryPoint matches a file name
    if (davidResult.files.length > 0) {
      const fileNames = davidResult.files.map((f) => f.name);
      if (!fileNames.includes(davidResult.entryPoint)) {
        console.log(`[BuildingLoop] [${iteration}] entryPoint "${davidResult.entryPoint}" not in files [${fileNames.join(', ')}], correcting to ${fileNames[0]}`);
        davidResult.entryPoint = fileNames[0];
      }
    }

    await updateFloorStatus(floorId, 'building', {
      buildOutput: serializeDavidResult(davidResult),
    } as Partial<Floor>);

    await logAgentAction({
      floorId,
      goalId: floor.goalId,
      agentName: 'David',
      iteration: iterationCount,
      action: 'build_complete',
      inputSummary: `Floor ${floor.floorNumber}: ${floor.name} | Approach: ${albaResult.approach.slice(0, 300)}`,
      outputSummary: davidResult.selfAuditReport.slice(0, 2000),
      durationMs: Date.now() - davidStartTime,
    });

    emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
      floorId,
      agent: 'David',
      action: 'build_complete',
      iteration: iterationCount,
    });

    // -------------------------------------------------------
    // C2. SYNTAX VALIDATION
    // -------------------------------------------------------
    if (davidResult.files.length > 0) {
      console.log(`[BuildingLoop] [${iteration}] Running syntax validation on ${davidResult.files.length} file(s)...`);
      const syntaxResult = await validateSyntax(davidResult.files);

      await logAgentAction({
        floorId,
        goalId: floor.goalId,
        agentName: 'SyntaxValidator',
        iteration: iterationCount,
        action: syntaxResult.valid ? 'syntax_passed' : 'syntax_failed',
        inputSummary: `Files: ${syntaxResult.checkedFiles.join(', ')}`,
        outputSummary: syntaxResult.valid
          ? `All ${syntaxResult.checkedFiles.length} file(s) passed syntax check`
          : `Syntax errors: ${syntaxResult.errors.join('; ')}`,
        durationMs: 0,
      });

      if (syntaxResult.valid) {
        davidResult.syntaxValid = true;
        emitEvent(BUILDING_EVENTS.SYNTAX_VALID, { floorId, files: syntaxResult.checkedFiles });
        console.log(`[BuildingLoop] [${iteration}] Syntax validation PASSED`);
      } else {
        davidResult.syntaxValid = false;
        emitEvent(BUILDING_EVENTS.SYNTAX_INVALID, { floorId, errors: syntaxResult.errors });
        console.log(`[BuildingLoop] [${iteration}] Syntax validation FAILED: ${syntaxResult.errors.join('; ')}`);

        // Store as Vex2 rejection so David sees it on retry
        await updateFloorStatus(floorId, 'auditing', {
          vexGate2Report: JSON.stringify({
            approved: false,
            verdict: `Syntax errors found: ${syntaxResult.errors.join('; ')}`,
            issues: syntaxResult.errors,
            specificFixes: syntaxResult.errors.map((e) => `Fix syntax error: ${e}`),
            qualityScore: 0,
          }),
        } as Partial<Floor>);

        // Update stored buildOutput with syntaxValid flag
        await updateFloorStatus(floorId, 'building', {
          buildOutput: serializeDavidResult(davidResult),
        } as Partial<Floor>);

        continue; // Back to Alba
      }

      // Update stored buildOutput with syntaxValid flag
      await updateFloorStatus(floorId, 'building', {
        buildOutput: serializeDavidResult(davidResult),
      } as Partial<Floor>);
    }

    // -------------------------------------------------------
    // D. VEX GATE 2
    // -------------------------------------------------------
    console.log(`[BuildingLoop] [${iteration}] Vex Gate 2 auditing build...`);
    await updateFloorStatus(floorId, 'auditing');
    emitEvent(BUILDING_EVENTS.FLOOR_STATUS, { floorId, status: 'auditing', iteration, gate: 2 });

    const vex2StartTime = Date.now();
    const vex2Message = buildVex2Message(floor, albaResult, davidResult);

    const vex2Raw = await routeAgentCall({
      systemPrompt: VEX_GATE2_PROMPT,
      userMessage: vex2Message,
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 2048,
      agentName: 'Vex2',
    });

    const vex2Result = parseJSON<VexGate2Result>(vex2Raw, 'Vex-Gate2');

    await updateFloorStatus(floorId, 'auditing', {
      vexGate2Report: JSON.stringify(vex2Result),
    } as Partial<Floor>);

    await logAgentAction({
      floorId,
      goalId: floor.goalId,
      agentName: 'Vex',
      iteration: iterationCount,
      action: vex2Result.approved ? 'gate2_approved' : 'gate2_rejected',
      inputSummary: `Build: ${davidResult.entryPoint}`,
      outputSummary: vex2Result.verdict.slice(0, 2000),
      durationMs: Date.now() - vex2StartTime,
    });

    emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
      floorId,
      agent: 'Vex',
      action: vex2Result.approved ? 'gate2_approved' : 'gate2_rejected',
      iteration: iterationCount,
      verdict: vex2Result.verdict,
      qualityScore: vex2Result.qualityScore,
    });

    if (!vex2Result.approved) {
      console.log(`[BuildingLoop] [${iteration}] Vex Gate 2 REJECTED: ${vex2Result.verdict}`);

      // Phase 8: Pattern failure feedback after 2+ Vex rejections
      if (iteration > 2 && existingPatterns.length > 0) {
        try {
          await recordPatternFailure(existingPatterns[0].id);
          console.log(`[BuildingLoop] Recorded pattern failure for "${existingPatterns[0].patternDescription.slice(0, 60)}"`);
        } catch {
          // best-effort
        }
      }

      // David will see this rejection next iteration via getPriorVex2Reports
      continue; // Back to Alba
    }

    console.log(`[BuildingLoop] [${iteration}] Vex Gate 2 APPROVED`);

    // -------------------------------------------------------
    // E. ELIRA REVIEW
    // -------------------------------------------------------
    console.log(`[BuildingLoop] [${iteration}] Elira reviewing...`);

    const eliraStartTime = Date.now();
    const eliraMessage = buildEliraReviewMessage(floor, davidResult, goal, buildingContext);

    const eliraRaw = await routeAgentCall({
      systemPrompt: ELIRA_FLOOR_REVIEW_PROMPT,
      userMessage: eliraMessage,
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 1024,
      agentName: 'Elira',
    });

    const eliraResult = parseJSON<EliraReviewResult>(eliraRaw, 'Elira');

    await logAgentAction({
      floorId,
      goalId: floor.goalId,
      agentName: 'Elira',
      iteration: iterationCount,
      action: eliraResult.verdict === 'approved' ? 'floor_approved' : 'floor_not_ready',
      inputSummary: `Floor ${floor.floorNumber}: ${floor.name}`,
      outputSummary: eliraResult.reason.slice(0, 2000),
      durationMs: Date.now() - eliraStartTime,
    });

    emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
      floorId,
      agent: 'Elira',
      action: eliraResult.verdict,
      iteration: iterationCount,
      reason: eliraResult.reason,
    });

    if (eliraResult.verdict !== 'approved') {
      console.log(`[BuildingLoop] [${iteration}] Elira NOT READY: ${eliraResult.reason}`);
      continue; // Back to Alba
    }

    // -------------------------------------------------------
    // F. FLOOR APPROVED — go live
    // -------------------------------------------------------
    console.log(`[BuildingLoop] Floor ${floor.floorNumber} "${floor.name}" is now LIVE`);
    notify(`✅ *Floor ${floor.floorNumber}* "${floor.name}" is now *LIVE*`);

    await updateFloorStatus(floorId, 'live', {
      buildOutput: serializeDavidResult(davidResult),
      handoffNotes: davidResult.handoffNotes,
      buildingContext: `Floor ${floor.floorNumber} delivered: ${davidResult.handoffNotes}`,
    } as Partial<Floor>);

    emitEvent(BUILDING_EVENTS.FLOOR_LIVE, {
      floorId,
      goalId: floor.goalId,
      floorNumber: floor.floorNumber,
      name: floor.name,
    });

    // Phase 9: Add floor to Stripe subscription
    try {
      const { getSubscription, addFloorToSubscription } = await import(
        './subscription-manager'
      );
      const sub = await getSubscription(floor.goalId);
      if (sub?.stripeSubscriptionId && sub.status === 'active') {
        await addFloorToSubscription(floor.goalId);
        console.log(`[BuildingLoop] Added floor billing for goal ${floor.goalId}`);
      }
    } catch (err) {
      console.error('[BuildingLoop] Floor billing failed:', err);
      // Never let billing failure break the build
    }

    // Phase 8: Pattern success feedback + save customer build pattern
    if (existingPatterns.length > 0) {
      try {
        await recordPatternSuccess(existingPatterns[0].id);
        console.log(`[BuildingLoop] Recorded pattern success for "${existingPatterns[0].patternDescription.slice(0, 60)}"`);
      } catch {
        // best-effort
      }
    }
    if (category) {
      try {
        await saveCustomerBuildPattern({
          category,
          patternDescription: `${floor.name}: ${floor.successCondition}`,
          implementationNotes: davidResult.handoffNotes.slice(0, 500),
        });
        console.log(`[BuildingLoop] Saved customer build pattern for category "${category}"`);
      } catch {
        // best-effort
      }
    }

    // Sync workspace files
    try {
      const { syncToFiles } = await import('@/lib/workspace/workspace-manager');
      await syncToFiles(floor.goalId);
    } catch {
      // best-effort
    }

    // Phase 3: Write floor output to customer workspace
    try {
      const { writeFloorOutput, writeSoulMd } = await import('@/lib/workspace-sync');
      const customerId = goal.customerId || floor.goalId;
      await writeFloorOutput(
        customerId,
        floor.floorNumber,
        floor.name,
        JSON.stringify(davidResult),
        davidResult.handoffNotes,
      );
      // Also update SOUL.md with current floor state
      const allFloors = goalWithFloors.floors ?? [];
      const floorInfos = allFloors.map((f: Floor) => ({
        floorNumber: f.floorNumber,
        name: f.name,
        status: f.id === floorId ? 'live' : f.status,
        description: f.description,
        successCondition: f.successCondition,
      }));
      await writeSoulMd(customerId, goal.goalText, floorInfos);
    } catch {
      // best-effort — workspace sync never blocks the loop
    }

    // Check if there is a next floor
    const nextFloor = await getNextFloor(floor.goalId, floor.floorNumber);

    if (nextFloor) {
      console.log(`[BuildingLoop] Activating next floor: ${nextFloor.floorNumber} "${nextFloor.name}"`);
      await updateFloorStatus(nextFloor.id, 'researching');

      emitEvent(BUILDING_EVENTS.FLOOR_STATUS, {
        floorId: nextFloor.id,
        status: 'researching',
        floorNumber: nextFloor.floorNumber,
        name: nextFloor.name,
      });

      // Start next floor sequentially within the same serverless invocation.
      // Previously used setImmediate fire-and-forget which gets killed on Vercel
      // when the function lifecycle ends. Running sequentially ensures all floors
      // complete within the same waitUntil context.
      // Depth is tracked to prevent unbounded stack growth.
      try {
        await runFloor(nextFloor.id, _depth + 1);
      } catch (err) {
        console.error(`[BuildingLoop] Next floor ${nextFloor.id} failed:`, err);
      }
    } else {
      // Last floor — goal met
      console.log(`[BuildingLoop] All floors complete. Goal met!`);
      notify(`🏆 *Goal met!* All floors complete for "${goal.goalText.slice(0, 80)}"`);
      await updateGoalStatus(floor.goalId, 'goal_met');

      emitEvent(BUILDING_EVENTS.GOAL_MET, {
        goalId: floor.goalId,
        goalText: goal.goalText,
      });

      // Sync workspace files after goal_met
      try {
        const { syncToFiles } = await import('@/lib/workspace/workspace-manager');
        await syncToFiles(floor.goalId);
      } catch {
        // best-effort
      }
    }

    return 'live';
  }

  // Max iterations exceeded
  console.error(`[BuildingLoop] Floor ${floorId} exceeded max iterations (${MAX_ITERATIONS}). Marking blocked.`);
  notify(`🚫 *Floor ${floor.floorNumber}* "${floor.name}" *blocked* — exceeded ${MAX_ITERATIONS} iterations`);
  await updateFloorStatus(floorId, 'blocked');

  emitEvent(BUILDING_EVENTS.FLOOR_BLOCKED, {
    floorId,
    goalId: floor.goalId,
    floorNumber: floor.floorNumber,
    name: floor.name,
    reason: `Exceeded ${MAX_ITERATIONS} iterations`,
  });

  await logAgentAction({
    floorId,
    goalId: floor.goalId,
    agentName: 'System',
    action: 'floor_blocked',
    outputSummary: `Floor ${floor.floorNumber} "${floor.name}" blocked after ${MAX_ITERATIONS} iterations.`,
  });

  return 'blocked';
}
