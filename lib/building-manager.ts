import { sql } from '@vercel/postgres';

// ============================================================
// Interfaces
// ============================================================

export interface Goal {
  id: string;
  customerId: string;
  goalText: string;
  customerContext: Record<string, unknown>;
  buildingSummary: string | null;
  status: 'planning' | 'building' | 'goal_met' | 'blocked';
  createdAt: Date;
  updatedAt: Date;
}

export interface Floor {
  id: string;
  goalId: string;
  floorNumber: number;
  name: string;
  description: string | null;
  successCondition: string;
  status:
    | 'pending'
    | 'researching'
    | 'building'
    | 'auditing'
    | 'live'
    | 'broken'
    | 'blocked';
  researchOutput: string | null;
  buildOutput: string | null;
  vexGate1Report: string | null;
  vexGate2Report: string | null;
  patternValidationReport: string | null;
  riskAnalysisReport: string | null;
  swarmValidationReport: string | null;
  iterationCount: number;
  buildingContext: string | null;
  handoffNotes: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface AgentLog {
  id: string;
  floorId: string | null;
  goalId: string | null;
  agentName: string;
  iteration: number;
  action: string;
  inputSummary: string | null;
  outputSummary: string | null;
  toolCallsMade: unknown[];
  tokensUsed: number;
  durationMs: number;
  timestamp: Date;
}

export interface HeartbeatLog {
  id: string;
  floorId: string;
  goalId: string;
  checkedAt: Date;
  conditionMet: boolean;
  stevenObservation: string | null;
  actionTaken: string | null;
}

// ============================================================
// Row mappers (snake_case DB rows -> camelCase TS interfaces)
// ============================================================

function mapGoalRow(row: Record<string, unknown>): Goal {
  return {
    id: row.id as string,
    customerId: row.customer_id as string,
    goalText: row.goal_text as string,
    customerContext: (row.customer_context as Record<string, unknown>) ?? {},
    buildingSummary: (row.building_summary as string) ?? null,
    status: row.status as Goal['status'],
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapFloorRow(row: Record<string, unknown>): Floor {
  return {
    id: row.id as string,
    goalId: row.goal_id as string,
    floorNumber: row.floor_number as number,
    name: row.name as string,
    description: (row.description as string) ?? null,
    successCondition: row.success_condition as string,
    status: row.status as Floor['status'],
    researchOutput: (row.research_output as string) ?? null,
    buildOutput: (row.build_output as string) ?? null,
    vexGate1Report: (row.vex_gate1_report as string) ?? null,
    vexGate2Report: (row.vex_gate2_report as string) ?? null,
    patternValidationReport: (row.pattern_validation_report as string) ?? null,
    riskAnalysisReport: (row.risk_analysis_report as string) ?? null,
    swarmValidationReport: (row.swarm_validation_report as string) ?? null,
    iterationCount: (row.iteration_count as number) ?? 0,
    buildingContext: (row.building_context as string) ?? null,
    handoffNotes: (row.handoff_notes as string) ?? null,
    createdAt: new Date(row.created_at as string),
    completedAt: row.completed_at
      ? new Date(row.completed_at as string)
      : null,
  };
}

function mapHeartbeatLogRow(row: Record<string, unknown>): HeartbeatLog {
  return {
    id: row.id as string,
    floorId: row.floor_id as string,
    goalId: row.goal_id as string,
    checkedAt: new Date(row.checked_at as string),
    conditionMet: row.condition_met as boolean,
    stevenObservation: (row.steven_observation as string) ?? null,
    actionTaken: (row.action_taken as string) ?? null,
  };
}

function mapAgentLogRow(row: Record<string, unknown>): AgentLog {
  return {
    id: row.id as string,
    floorId: (row.floor_id as string) ?? null,
    goalId: (row.goal_id as string) ?? null,
    agentName: row.agent_name as string,
    iteration: (row.iteration as number) ?? 1,
    action: row.action as string,
    inputSummary: (row.input_summary as string) ?? null,
    outputSummary: (row.output_summary as string) ?? null,
    toolCallsMade: (row.tool_calls_made as unknown[]) ?? [],
    tokensUsed: (row.tokens_used as number) ?? 0,
    durationMs: (row.duration_ms as number) ?? 0,
    timestamp: new Date(row.timestamp as string),
  };
}

// ============================================================
// GOALS
// ============================================================

export async function createGoal(params: {
  customerId: string;
  goalText: string;
  customerContext?: Record<string, unknown>;
}): Promise<Goal> {
  const ctx = params.customerContext
    ? JSON.stringify(params.customerContext)
    : '{}';

  const { rows } = await sql`
    INSERT INTO goals (customer_id, goal_text, customer_context)
    VALUES (${params.customerId}, ${params.goalText}, ${ctx}::jsonb)
    RETURNING *
  `;

  const goal = mapGoalRow(rows[0]);

  // Sync building state to workspace files
  try {
    const { syncToFiles } = await import('@/lib/workspace/workspace-manager');
    await syncToFiles(goal.id);
  } catch {
    // Workspace sync is best-effort; don't block goal creation
  }

  return goal;
}

export async function getGoal(
  goalId: string,
): Promise<Goal & { floors: Floor[] }> {
  const { rows: goalRows } = await sql`
    SELECT * FROM goals WHERE id = ${goalId}
  `;

  if (goalRows.length === 0) {
    throw new Error(`Goal not found: ${goalId}`);
  }

  const { rows: floorRows } = await sql`
    SELECT * FROM floors
    WHERE goal_id = ${goalId}
    ORDER BY floor_number ASC
  `;

  return {
    ...mapGoalRow(goalRows[0]),
    floors: floorRows.map(mapFloorRow),
  };
}

export async function updateGoalStatus(
  goalId: string,
  status: Goal['status'],
): Promise<void> {
  await sql`
    UPDATE goals
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${goalId}
  `;
}

export async function updateGoalSummary(
  goalId: string,
  buildingSummary: string,
): Promise<void> {
  await sql`
    UPDATE goals
    SET building_summary = ${buildingSummary}, updated_at = NOW()
    WHERE id = ${goalId}
  `;
}

/**
 * Soft-delete a goal (Steven Delta SD-003).
 * Sets deleted_at timestamp instead of removing the row.
 */
export async function softDeleteGoal(goalId: string): Promise<void> {
  await sql`
    UPDATE goals
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${goalId} AND deleted_at IS NULL
  `;
}

/**
 * Archive a goal (Steven Delta SD-004).
 * Sets archived_at timestamp for old, completed goals.
 */
export async function archiveGoal(goalId: string): Promise<void> {
  await sql`
    UPDATE goals
    SET archived_at = NOW(), updated_at = NOW()
    WHERE id = ${goalId} AND archived_at IS NULL
  `;
}

// ============================================================
// FLOORS
// ============================================================

export async function createFloor(params: {
  goalId: string;
  floorNumber: number;
  name: string;
  description: string;
  successCondition: string;
}): Promise<Floor> {
  const { rows } = await sql`
    INSERT INTO floors (goal_id, floor_number, name, description, success_condition)
    VALUES (
      ${params.goalId},
      ${params.floorNumber},
      ${params.name},
      ${params.description},
      ${params.successCondition}
    )
    RETURNING *
  `;

  return mapFloorRow(rows[0]);
}

export async function updateFloorStatus(
  floorId: string,
  status: Floor['status'],
  extras?: Partial<Floor>,
): Promise<void> {
  // Build the completed_at value
  const completedAt =
    status === 'live' ? new Date().toISOString() : null;

  const { rows } = await sql`
    UPDATE floors
    SET
      status = ${status},
      research_output = COALESCE(${extras?.researchOutput ?? null}, research_output),
      build_output = COALESCE(${extras?.buildOutput ?? null}, build_output),
      vex_gate1_report = COALESCE(${extras?.vexGate1Report ?? null}, vex_gate1_report),
      vex_gate2_report = COALESCE(${extras?.vexGate2Report ?? null}, vex_gate2_report),
      pattern_validation_report = COALESCE(${extras?.patternValidationReport ?? null}, pattern_validation_report),
      risk_analysis_report = COALESCE(${extras?.riskAnalysisReport ?? null}, risk_analysis_report),
      swarm_validation_report = COALESCE(${extras?.swarmValidationReport ?? null}, swarm_validation_report),
      building_context = COALESCE(${extras?.buildingContext ?? null}, building_context),
      handoff_notes = COALESCE(${extras?.handoffNotes ?? null}, handoff_notes),
      completed_at = COALESCE(${completedAt}::timestamptz, completed_at)
    WHERE id = ${floorId}
    RETURNING goal_id
  `;

  // Sync building state to workspace files
  if (rows.length > 0) {
    try {
      const goalId = rows[0].goal_id as string;
      const { syncToFiles } = await import('@/lib/workspace/workspace-manager');
      await syncToFiles(goalId);
    } catch {
      // Workspace sync is best-effort; don't block status update
    }
  }
}

export async function getFloor(floorId: string): Promise<Floor | null> {
  const { rows } = await sql`
    SELECT * FROM floors WHERE id = ${floorId}
  `;

  if (rows.length === 0) return null;
  return mapFloorRow(rows[0]);
}

export async function getNextFloor(
  goalId: string,
  currentFloorNumber: number,
): Promise<Floor | null> {
  const { rows } = await sql`
    SELECT * FROM floors
    WHERE goal_id = ${goalId}
      AND floor_number > ${currentFloorNumber}
      AND status = 'pending'
    ORDER BY floor_number ASC
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return mapFloorRow(rows[0]);
}

export async function getPriorVex2Reports(floorId: string): Promise<string[]> {
  const { rows } = await sql`
    SELECT output_summary FROM agent_logs
    WHERE floor_id = ${floorId}
      AND agent_name = 'Vex'
      AND action = 'gate2_rejected'
    ORDER BY timestamp ASC
  `;

  return rows
    .map((r) => r.output_summary as string)
    .filter((s) => s != null);
}

export async function getBuildingContext(goalId: string): Promise<string> {
  const { rows } = await sql`
    SELECT floor_number, name, status, building_context, handoff_notes
    FROM floors
    WHERE goal_id = ${goalId}
    ORDER BY floor_number ASC
  `;

  if (rows.length === 0) return 'No floors created yet.';

  const lines = rows.map((r) => {
    const ctx = r.building_context ? ` | Context: ${r.building_context}` : '';
    const notes = r.handoff_notes ? ` | Handoff: ${r.handoff_notes}` : '';
    return `Floor ${r.floor_number} (${r.name}): ${r.status}${ctx}${notes}`;
  });

  return lines.join('\n');
}

export async function incrementIteration(floorId: string): Promise<number> {
  const { rows } = await sql`
    UPDATE floors
    SET iteration_count = iteration_count + 1
    WHERE id = ${floorId}
    RETURNING iteration_count
  `;

  if (rows.length === 0) {
    throw new Error(`Floor not found: ${floorId}`);
  }

  return rows[0].iteration_count as number;
}

// ============================================================
// LOGS
// ============================================================

export async function logAgentAction(params: {
  floorId?: string;
  goalId: string;
  agentName: string;
  iteration?: number;
  action: string;
  inputSummary?: string;
  outputSummary?: string;
  toolCallsMade?: unknown[];
  tokensUsed?: number;
  durationMs?: number;
}): Promise<void> {
  const toolCalls = params.toolCallsMade
    ? JSON.stringify(params.toolCallsMade)
    : '[]';

  await sql`
    INSERT INTO agent_logs (
      floor_id, goal_id, agent_name, iteration, action,
      input_summary, output_summary, tool_calls_made,
      tokens_used, duration_ms
    )
    VALUES (
      ${params.floorId ?? null},
      ${params.goalId},
      ${params.agentName},
      ${params.iteration ?? 1},
      ${params.action},
      ${params.inputSummary ?? null},
      ${params.outputSummary ?? null},
      ${toolCalls}::jsonb,
      ${params.tokensUsed ?? 0},
      ${params.durationMs ?? 0}
    )
  `;
}

export async function getRecentLogs(
  goalId: string,
  limit: number = 20,
): Promise<AgentLog[]> {
  const { rows } = await sql`
    SELECT * FROM agent_logs
    WHERE goal_id = ${goalId}
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `;

  return rows.map(mapAgentLogRow);
}

// ============================================================
// HEARTBEAT HELPERS (Phase 5 — Steven)
// ============================================================

export async function getLiveFloors(goalId: string): Promise<Floor[]> {
  const { rows } = await sql`
    SELECT * FROM floors
    WHERE goal_id = ${goalId}
      AND status = 'live'
    ORDER BY floor_number ASC
  `;

  return rows.map(mapFloorRow);
}

export async function getAllFloors(goalId: string): Promise<Floor[]> {
  const { rows } = await sql`
    SELECT * FROM floors
    WHERE goal_id = ${goalId}
    ORDER BY floor_number ASC
  `;

  return rows.map(mapFloorRow);
}

/**
 * Get floors stuck in an in-progress status (researching, building, auditing)
 * for a given goal. Used by stall recovery to detect floors that stopped
 * progressing without transitioning to live/blocked/broken.
 */
export async function getInProgressFloors(goalId: string): Promise<Floor[]> {
  const { rows } = await sql`
    SELECT * FROM floors
    WHERE goal_id = ${goalId}
      AND status IN ('researching', 'building', 'auditing')
    ORDER BY floor_number ASC
  `;

  return rows.map(mapFloorRow);
}

/**
 * Get the timestamp of the most recent agent log for a specific floor.
 * Returns null if no logs exist.
 */
export async function getLastAgentLogTime(floorId: string): Promise<Date | null> {
  const { rows } = await sql`
    SELECT timestamp FROM agent_logs
    WHERE floor_id = ${floorId}
    ORDER BY timestamp DESC
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return new Date(rows[0].timestamp as string);
}

export async function getRecentHeartbeats(
  floorId: string,
  limit: number = 3,
): Promise<HeartbeatLog[]> {
  const { rows } = await sql`
    SELECT * FROM heartbeat_logs
    WHERE floor_id = ${floorId}
    ORDER BY checked_at DESC
    LIMIT ${limit}
  `;

  return rows.map(mapHeartbeatLogRow);
}

export async function resetFloor(floorId: string): Promise<void> {
  // [AUTO-ADDED] BUG-1-10: Also clear pattern_validation_report,
  // risk_analysis_report, and swarm_validation_report so stale
  // validation data from a previous iteration doesn't leak into
  // David's prediction prompt on the next build cycle.
  await sql`
    UPDATE floors
    SET
      status = 'pending',
      iteration_count = 0,
      research_output = NULL,
      build_output = NULL,
      vex_gate1_report = NULL,
      vex_gate2_report = NULL,
      pattern_validation_report = NULL,
      risk_analysis_report = NULL,
      swarm_validation_report = NULL,
      building_context = NULL,
      handoff_notes = NULL,
      completed_at = NULL
    WHERE id = ${floorId}
  `;
}

export async function saveStevenSuggestion(
  goalId: string,
  floorId: string,
  suggestion: string,
): Promise<void> {
  await sql`
    INSERT INTO agent_logs (
      floor_id, goal_id, agent_name, iteration, action,
      input_summary, output_summary, tool_calls_made,
      tokens_used, duration_ms
    )
    VALUES (
      ${floorId},
      ${goalId},
      'Steven',
      1,
      'automation_suggestion',
      ${`Floor ${floorId}`},
      ${suggestion},
      '[]'::jsonb,
      0,
      0
    )
  `;
}

export async function getStevenSuggestions(goalId: string): Promise<string[]> {
  const { rows } = await sql`
    SELECT output_summary FROM agent_logs
    WHERE goal_id = ${goalId}
      AND agent_name = 'Steven'
      AND action = 'automation_suggestion'
    ORDER BY timestamp DESC
  `;

  return rows
    .map((r) => r.output_summary as string)
    .filter((s) => s != null);
}

// ============================================================
// HEARTBEAT LOG (existing)
// ============================================================

export async function logHeartbeat(params: {
  floorId: string;
  goalId: string;
  conditionMet: boolean;
  stevenObservation?: string;
  actionTaken: 'healthy' | 'rerun' | 'escalate' | 'billing_paused';
}): Promise<void> {
  await sql`
    INSERT INTO heartbeat_logs (
      floor_id, goal_id, condition_met,
      steven_observation, action_taken
    )
    VALUES (
      ${params.floorId},
      ${params.goalId},
      ${params.conditionMet},
      ${params.stevenObservation ?? null},
      ${params.actionTaken}
    )
  `;
}

// ============================================================
// BUILDING TEMPLATES (Phase 10 — Step 2)
// ============================================================

export interface BuildingTemplate {
  id: string;
  goalText: string;
  buildingSummary: string;
  category: string | null;
  floorBlueprints: FloorBlueprint[];
  useCount: number;
  avgCompletionHours: number | null;
  isPublic: boolean;
  sourceGoalId: string;
  createdAt: Date;
}

export interface FloorBlueprint {
  floorNumber: number;
  name: string;
  description: string;
  successCondition: string;
}

function mapTemplateRow(row: Record<string, unknown>): BuildingTemplate {
  let blueprints: FloorBlueprint[] = [];
  try {
    const raw = row.floor_blueprints;
    if (typeof raw === 'string') {
      blueprints = JSON.parse(raw) as FloorBlueprint[];
    } else if (Array.isArray(raw)) {
      blueprints = raw as FloorBlueprint[];
    }
  } catch {
    // malformed JSON — return empty
  }

  return {
    id: row.id as string,
    goalText: row.goal_text as string,
    buildingSummary: (row.building_summary as string) ?? '',
    category: (row.category as string) ?? null,
    floorBlueprints: blueprints,
    useCount: (row.use_count as number) ?? 0,
    avgCompletionHours: (row.avg_completion_hours as number) ?? null,
    isPublic: (row.is_public as boolean) ?? true,
    sourceGoalId: row.source_goal_id as string,
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * Save a completed goal as a reusable template.
 * Called from checkGoalCompletion after goal_met.
 */
export async function saveAsTemplate(goalId: string): Promise<void> {
  const goal = await getGoal(goalId);

  const blueprints: FloorBlueprint[] = goal.floors.map((f) => ({
    floorNumber: f.floorNumber,
    name: f.name,
    description: f.description ?? '',
    successCondition: f.successCondition,
  }));

  // Detect category from first floor
  let category: string | null = null;
  try {
    const { detectCategory } = await import('./pattern-manager');
    const f = goal.floors[0];
    if (f) {
      category = detectCategory(f.name, f.description ?? '', f.successCondition);
    }
  } catch {
    // pattern-manager not available
  }

  // Calculate average completion hours
  const completedFloors = goal.floors.filter((f) => f.completedAt && f.createdAt);
  let avgHours: number | null = null;
  if (completedFloors.length > 0) {
    const totalMs = completedFloors.reduce((sum, f) => {
      const ms = (f.completedAt!.getTime() - f.createdAt.getTime());
      return sum + ms;
    }, 0);
    avgHours = Math.round((totalMs / completedFloors.length / 3600000) * 10) / 10;
  }

  const blueprintJson = JSON.stringify(blueprints);

  await sql`
    INSERT INTO building_templates (
      goal_text, building_summary, category,
      floor_blueprints, avg_completion_hours, source_goal_id
    )
    VALUES (
      ${goal.goalText},
      ${goal.buildingSummary ?? ''},
      ${category},
      ${blueprintJson}::jsonb,
      ${avgHours},
      ${goalId}
    )
  `;

  console.log(`[Templates] Saved template from goal ${goalId} (${goal.floors.length} floors)`);
}

/**
 * Get the best matching template for a category.
 */
export async function getBestTemplate(
  category: string,
): Promise<BuildingTemplate | null> {
  const { rows } = await sql`
    SELECT * FROM building_templates
    WHERE category = ${category}
      AND is_public = TRUE
    ORDER BY use_count DESC, avg_completion_hours ASC NULLS LAST
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return mapTemplateRow(rows[0]);
}

/**
 * Get all public templates.
 */
export async function getPublicTemplates(
  limit: number = 20,
): Promise<BuildingTemplate[]> {
  const { rows } = await sql`
    SELECT * FROM building_templates
    WHERE is_public = TRUE
    ORDER BY use_count DESC, created_at DESC
    LIMIT ${limit}
  `;

  return rows.map(mapTemplateRow);
}

/**
 * Get a single template by ID.
 */
export async function getTemplate(
  templateId: string,
): Promise<BuildingTemplate | null> {
  const { rows } = await sql`
    SELECT * FROM building_templates
    WHERE id = ${templateId}
  `;

  if (rows.length === 0) return null;
  return mapTemplateRow(rows[0]);
}

/**
 * Increment use_count when a customer uses a template.
 */
export async function incrementTemplateUseCount(
  templateId: string,
): Promise<void> {
  await sql`
    UPDATE building_templates
    SET use_count = use_count + 1
    WHERE id = ${templateId}
  `;
}

// ============================================================
// FLOOR SNAPSHOTS (Phase 10 — Step 3)
// ============================================================

export interface FloorSnapshot {
  id: string;
  floorId: string;
  reason: string;
  status: Floor['status'];
  researchOutput: string | null;
  buildOutput: string | null;
  vexGate1Report: string | null;
  vexGate2Report: string | null;
  iterationCount: number;
  buildingContext: string | null;
  handoffNotes: string | null;
  createdAt: Date;
}

function mapSnapshotRow(row: Record<string, unknown>): FloorSnapshot {
  return {
    id: row.id as string,
    floorId: row.floor_id as string,
    reason: (row.reason as string) ?? '',
    status: row.status as Floor['status'],
    researchOutput: (row.research_output as string) ?? null,
    buildOutput: (row.build_output as string) ?? null,
    vexGate1Report: (row.vex_gate1_report as string) ?? null,
    vexGate2Report: (row.vex_gate2_report as string) ?? null,
    iterationCount: (row.iteration_count as number) ?? 0,
    buildingContext: (row.building_context as string) ?? null,
    handoffNotes: (row.handoff_notes as string) ?? null,
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * Snapshot the current state of a floor before destructive changes.
 */
export async function snapshotFloor(
  floorId: string,
  reason: string,
): Promise<string> {
  const floor = await getFloor(floorId);
  if (!floor) {
    throw new Error(`Floor not found: ${floorId}`);
  }

  const { rows } = await sql`
    INSERT INTO floor_snapshots (
      floor_id, reason, status,
      research_output, build_output,
      vex_gate1_report, vex_gate2_report,
      iteration_count, building_context, handoff_notes
    )
    VALUES (
      ${floorId},
      ${reason},
      ${floor.status},
      ${floor.researchOutput},
      ${floor.buildOutput},
      ${floor.vexGate1Report},
      ${floor.vexGate2Report},
      ${floor.iterationCount},
      ${floor.buildingContext},
      ${floor.handoffNotes}
    )
    RETURNING id
  `;

  const snapshotId = rows[0].id as string;
  console.log(`[Snapshots] Created snapshot ${snapshotId} for floor ${floorId}: ${reason}`);
  return snapshotId;
}

/**
 * Rollback a floor to a previous snapshot state.
 */
export async function rollbackFloor(
  floorId: string,
  snapshotId: string,
): Promise<void> {
  const { rows } = await sql`
    SELECT * FROM floor_snapshots
    WHERE id = ${snapshotId} AND floor_id = ${floorId}
  `;

  if (rows.length === 0) {
    throw new Error(`Snapshot ${snapshotId} not found for floor ${floorId}`);
  }

  const snap = mapSnapshotRow(rows[0]);

  await sql`
    UPDATE floors
    SET
      status = ${snap.status},
      research_output = ${snap.researchOutput},
      build_output = ${snap.buildOutput},
      vex_gate1_report = ${snap.vexGate1Report},
      vex_gate2_report = ${snap.vexGate2Report},
      iteration_count = ${snap.iterationCount},
      building_context = ${snap.buildingContext},
      handoff_notes = ${snap.handoffNotes},
      completed_at = NULL
    WHERE id = ${floorId}
  `;

  console.log(`[Snapshots] Rolled back floor ${floorId} to snapshot ${snapshotId}`);
}

/**
 * Get all snapshots for a floor.
 */
export async function getFloorSnapshots(
  floorId: string,
): Promise<FloorSnapshot[]> {
  const { rows } = await sql`
    SELECT * FROM floor_snapshots
    WHERE floor_id = ${floorId}
    ORDER BY created_at DESC
  `;

  return rows.map(mapSnapshotRow);
}

/**
 * Get pending expansions for a goal (logged by Elira expansion evaluator).
 */
export async function getPendingExpansions(goalId: string): Promise<Array<{
  name: string;
  description: string;
  successCondition: string;
  reasoning: string;
  suggestedAt: Date;
}>> {
  const { rows } = await sql`
    SELECT output_summary, timestamp FROM agent_logs
    WHERE goal_id = ${goalId}
      AND agent_name = 'Elira'
      AND action = 'expansion_suggested'
    ORDER BY timestamp DESC
    LIMIT 5
  `;

  const expansions: Array<{
    name: string;
    description: string;
    successCondition: string;
    reasoning: string;
    suggestedAt: Date;
  }> = [];

  for (const row of rows) {
    try {
      const data = JSON.parse(row.output_summary as string);
      expansions.push({
        name: data.name ?? 'Unknown',
        description: data.description ?? '',
        successCondition: data.successCondition ?? '',
        reasoning: '',
        suggestedAt: new Date(row.timestamp as string),
      });
    } catch {
      // malformed JSON — skip
    }
  }

  return expansions;
}
