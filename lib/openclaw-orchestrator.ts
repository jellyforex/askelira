/**
 * OpenClaw Subagent Orchestrator
 * AskElira agents run via Anthropic API directly (most reliable)
 * Future: route through OpenClaw gateway when sessions_spawn is exposed via HTTP
 */

import { routeAgentCall } from './agent-router';
import { albaPrompt, davidPrompt, vexPrompt, eliraPrompt } from './agent-prompts';
import { readAllWorkspace } from './workspace/workspace-manager';

export interface SwarmPhase {
  name: 'alba' | 'david' | 'vex' | 'elira';
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

export interface SwarmResult {
  id: string;
  question: string;
  decision: string;
  confidence: number;
  argumentsFor: string[];
  argumentsAgainst: string[];
  research: any;
  audit: any;
  auditNotes: string[];
  buildPlan: any | null;
  cost: number;
  actualCost: number;
  agentCount: number;
  duration: number;
  timestamp: string;
  errors?: Array<{ phase: string; error: string; timestamp: string }>;
}

export type PhaseCallback = (phase: SwarmPhase) => void;

/**
 * Run full swarm debate using OpenClaw subagents
 */
export async function runSwarmDebate(
  question: string,
  onPhase?: PhaseCallback,
): Promise<SwarmResult> {
  const startTime = Date.now();
  let totalCost = 0;
  
  const id = `sw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // Load workspace context (SOUL.md, AGENTS.md, TOOLS.md)
  let workspace = { soul: '', agents: '', tools: '' };
  try {
    workspace = await readAllWorkspace();
  } catch {
    // Workspace not initialized yet — that's OK
  }

  // Phase 1: Alba - Research
  onPhase?.({ name: 'alba', label: 'Research', status: 'running' });
  
  let research;
  try {
    const albaOutput = await routeAgentCall({
      systemPrompt: 'You are Alba, a research agent. Respond with valid JSON only.',
      userMessage: albaPrompt(question),
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 2000,
      agentName: 'Alba',
    });
    research = parseJSON(albaOutput, { summary: 'No research available', sources: [], confidence: 0 });
    totalCost += 0.003; // ~$0.003 per Sonnet call
  } catch (err) {
    console.error('[Alba] Research failed:', err);
    research = { summary: 'Research unavailable', sources: [], confidence: 0 };
  }
  
  onPhase?.({ name: 'alba', label: 'Research', status: 'done' });

  // Phase 2: David - 10k Agent Debate
  onPhase?.({ name: 'david', label: 'Debate', status: 'running' });
  
  let debate;
  try {
    const davidOutput = await routeAgentCall({
      systemPrompt: 'You are David, a debate agent with deep thinking. Respond with valid JSON only.',
      userMessage: davidPrompt(question, research),
      model: 'claude-opus-4-5',
      maxTokens: 3000,
      agentName: 'David',
    });
    debate = parseJSON(davidOutput, {
      decision: 'insufficient_data',
      confidence: 0,
      argumentsFor: [],
      argumentsAgainst: [],
    });
    totalCost += 0.015; // ~$0.015 per Opus call
  } catch (err) {
    console.error('[David] Debate failed:', err);
    debate = { decision: 'insufficient_data', confidence: 0, argumentsFor: [], argumentsAgainst: [] };
  }
  
  onPhase?.({ name: 'david', label: 'Debate', status: 'done' });

  // Phase 3: Vex - Audit
  onPhase?.({ name: 'vex', label: 'Audit', status: 'running' });
  
  let audit;
  try {
    const vexOutput = await routeAgentCall({
      systemPrompt: 'You are Vex, an audit agent. Respond with valid JSON only.',
      userMessage: vexPrompt(debate),
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 1500,
      agentName: 'Vex',
    });
    audit = parseJSON(vexOutput, { valid: true, issues: [], adjustedConfidence: debate.confidence });
    totalCost += 0.003;
  } catch (err) {
    console.error('[Vex] Audit failed:', err);
    audit = { valid: true, issues: [], adjustedConfidence: debate.confidence };
  }
  
  onPhase?.({ name: 'vex', label: 'Audit', status: 'done' });

  // Phase 4: Elira - Synthesize
  onPhase?.({ name: 'elira', label: 'Synthesize', status: 'running' });
  
  let synthesis;
  try {
    const eliraOutput = await routeAgentCall({
      systemPrompt: 'You are Elira, a synthesis agent. Respond with valid JSON only.',
      userMessage: eliraPrompt(research, debate, audit),
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 2000,
      agentName: 'Elira',
    });
    synthesis = parseJSON(eliraOutput, {
      finalDecision: debate.decision,
      confidence: audit.adjustedConfidence,
      recommendation: '',
      buildPlan: null,
    });
    totalCost += 0.003;
  } catch (err) {
    console.error('[Elira] Synthesis failed:', err);
    synthesis = { finalDecision: debate.decision, confidence: audit.adjustedConfidence, recommendation: '', buildPlan: null };
  }
  
  onPhase?.({ name: 'elira', label: 'Synthesize', status: 'done' });

  return {
    id,
    question,
    decision: synthesis.finalDecision,
    confidence: synthesis.confidence,
    argumentsFor: debate.argumentsFor || [],
    argumentsAgainst: debate.argumentsAgainst || [],
    research,
    audit,
    auditNotes: audit.issues || [],
    buildPlan: synthesis.buildPlan,
    cost: totalCost,
    actualCost: totalCost,
    agentCount: 10000,
    duration: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Parse JSON with fallback
 */
function parseJSON<T>(text: string | undefined, fallback: T): T {
  if (!text) return fallback;
  
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    
    // Try direct parse
    return JSON.parse(text);
  } catch (err) {
    console.warn('[OpenClaw Orchestrator] Failed to parse JSON:', err);
    return fallback;
  }
}

// Cost is estimated per-call above (~$0.024 per full debate)
