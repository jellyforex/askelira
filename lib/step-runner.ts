/**
 * Step Runner — Breaks the building loop into individual API-callable steps.
 *
 * On Vercel Hobby plan, max function duration is 60s. The monolithic runFloor()
 * runs all agents (Alba ~13s, Vex1 ~12s, David ~60-120s, Vex2 ~12s, Elira ~10s)
 * sequentially in one invocation — exceeding 60s.
 *
 * Each step runs ONE agent, saves output to DB, and chains to the next step
 * via a self-calling fetch + waitUntil.
 *
 * Steps: alba -> vex1 -> david -> vex2 -> elira -> finalize
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
import { runOpenResearch, type OpenResearchResult } from './autoresearch';
import { webSearch, type SearchResult, type WebSearchOptions } from './web-search';
import { getPersonalContext, type PersonalContext } from './personal-context';
import { validateAgainstPatterns, type PatternValidationResult } from './validators/pattern-matcher';
import { analyzeRisks, type RiskAnalysisResult } from './validators/risk-analyzer';
import { runSwarmValidation, type SwarmValidationResult } from './validators/swarm-intelligence';
import { generatePredictionPrompt, formatForDavid } from './prediction-prompt-generator';
import { notify } from './notify';

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
import { getInternalBaseUrl } from './internal-fetch';
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
// Types
// ============================================================

export type StepName = 'alba' | 'vex1' | 'david' | 'vex2' | 'elira' | 'finalize';

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

export interface StepResult {
  step: StepName;
  success: boolean;
  nextStep: StepName | 'done' | 'retry_alba';
  message: string;
  floorId: string;
  iteration: number;
}

const MAX_ITERATIONS = 5;

// ============================================================
// Helpers
// ============================================================

function emitEvent(event: string, data: unknown): void {
  try {
    console.log(`[EVENT] ${event}`, JSON.stringify(data));
  } catch (e) {
    console.error('Event emit failed:', event, e);
  }
}

/**
 * Combine OpenResearch, Brave Search, and Personal Context into unified research output
 */
interface CombinedResearch {
  deepResearch: string;
  webResults: SearchResult[];
  personalContext: PersonalContext;
  combinedSummary: string;
  allSources: Array<{ title: string; url: string; snippet?: string }>;
}

async function combineResearch(
  floorName: string,
  floorDescription: string | null,
  customerId: string,
  openResearchResult?: OpenResearchResult,
  braveResults?: SearchResult[],
  userContext?: PersonalContext,
): Promise<CombinedResearch> {
  const sources: Array<{ title: string; url: string; snippet?: string }> = [];

  // Collect sources from OpenResearch
  if (openResearchResult?.sources) {
    sources.push(...openResearchResult.sources);
  }

  // Collect sources from Brave Search
  if (braveResults) {
    sources.push(...braveResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })));
  }

  // Generate combined summary
  const parts: string[] = [];

  if (openResearchResult) {
    parts.push('## Deep Research Findings:');
    parts.push(openResearchResult.finalReport);
    parts.push('');
  }

  if (braveResults && braveResults.length > 0) {
    parts.push('## Web Search Results:');
    braveResults.forEach((result, idx) => {
      parts.push(`${idx + 1}. **${result.title}**`);
      parts.push(`   ${result.snippet}`);
      parts.push(`   Source: ${result.url}`);
      parts.push('');
    });
  }

  if (userContext) {
    parts.push('## User Context:');
    parts.push(`- Preferred Language: ${userContext.preferences.language}`);
    parts.push(`- Timezone: ${userContext.preferences.timezone}`);
    parts.push(`- Email Provider: ${userContext.preferences.emailProvider}`);
    parts.push(`- LLM Provider: ${userContext.preferences.llmProvider}`);
    if (userContext.history.commonPatterns.length > 0) {
      parts.push(`- Past Success Patterns: ${userContext.history.commonPatterns.join(', ')}`);
    }
    parts.push('');
  }

  return {
    deepResearch: openResearchResult?.finalReport || '',
    webResults: braveResults || [],
    personalContext: userContext || {
      userId: customerId,
      preferences: { language: 'python', timezone: 'UTC', emailProvider: 'none', llmProvider: 'unknown', hasWebSearch: false },
      history: { totalBuilds: 0, successfulBuilds: 0, recentBuilds: [], commonPatterns: [] },
      apiKeys: { hasAgentMail: false, hasBraveSearch: false, hasAnthropicKey: false, hasOpenAIKey: false, hasSendGrid: false, hasStripe: false },
      metadata: { timestamp: Date.now(), configPath: '', cached: false },
    },
    combinedSummary: parts.join('\n'),
    allSources: sources,
  };
}

function parseJSON<T>(raw: string, agentName: string): T {
  let text = raw.trim();

  // Try to match complete markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  } else if (text.startsWith('```')) {
    // Handle incomplete or single-line code fences
    text = text.replace(/^```[a-z]*\s*/, ''); // Remove opening fence
    text = text.replace(/\s*```\s*$/, ''); // Remove closing fence if present
    text = text.trim();
  }

  // Additional cleanup: strip any remaining backticks at start/end
  text = text.replace(/^`+/, '').replace(/`+$/, '').trim();

  try {
    return JSON.parse(text) as T;
  } catch {
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
        // fall through
      }
    }

    if (startIdx >= 0) {
      const closingBrace = text.lastIndexOf('}');
      const closingBracket = text.lastIndexOf(']');
      const endIdx = Math.max(closingBrace, closingBracket);
      if (endIdx > startIdx) {
        const substring = text.slice(startIdx, endIdx + 1);
        try {
          return JSON.parse(substring) as T;
        } catch {
          // fall through
        }
      }
    }

    // Last resort: regex extract the largest JSON object from prose
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        // fall through
      }
    }

    throw new Error(
      `[${agentName}] Failed to parse JSON response.\n\nRaw (first 2000 chars):\n${raw.slice(0, 2000)}`,
    );
  }
}

// Use shared getInternalBaseUrl from lib/internal-fetch.ts
// (replaces local getBaseUrl that had VERCEL_URL empty-string bug)

// ============================================================
// Chain to next step via internal API call
// ============================================================

export async function chainNextStep(
  floorId: string,
  nextStep: StepName,
  iteration: number,
): Promise<void> {
  const baseUrl = getInternalBaseUrl();
  const secret = process.env.CRON_SECRET || '';

  const url = `${baseUrl}/api/loop/step/${floorId}?step=${nextStep}&iteration=${iteration}`;
  console.log(`[StepRunner] Chaining to ${nextStep} for floor ${floorId}: ${url}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': secret,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      console.error(`[StepRunner] Chain call failed (${res.status}): ${text}`);
    }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (isAbort) {
      console.log(`[StepRunner] Chain call sent (timed out waiting for response -- expected on Vercel)`);
    } else {
      console.error(`[StepRunner] Chain call error:`, err);
    }
  }
}

// ============================================================
// Step: Alba Research
// ============================================================

export async function runAlbaStep(floorId: string, iteration: number): Promise<StepResult> {
  console.log(`[StepRunner] Alba research for floor ${floorId}, iteration ${iteration}`);

  const floor = await getFloor(floorId);
  if (!floor) throw new Error(`Floor not found: ${floorId}`);

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

  const iterationCount = await incrementIteration(floorId);
  const buildingContext = await getBuildingContext(floor.goalId);

  emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
    floorId,
    goalId: floor.goalId,
    iteration: iterationCount,
    phase: 'loop_start',
  });

  await updateFloorStatus(floorId, 'researching');
  emitEvent(BUILDING_EVENTS.FLOOR_STATUS, { floorId, status: 'researching', iteration: iterationCount });

  // Detect patterns (best-effort)
  let existingPatterns: AutomationPattern[] = [];
  try {
    const category = detectCategory(floor.name, floor.description ?? '', floor.successCondition);
    if (category) {
      existingPatterns = await getTopPatterns(category, 3, 0.6);
    }
  } catch {
    // best-effort
  }

  // Check for prior Vex1 rejection from previous iteration
  let priorVex1Report: string | undefined;
  if (floor.vexGate1Report && iteration > 1) {
    try {
      const vex1Data = JSON.parse(floor.vexGate1Report);
      if (!vex1Data.approved) {
        priorVex1Report = floor.vexGate1Report;
      }
    } catch {
      // ignore
    }
  }

  const albaStartTime = Date.now();

  // Step 1: Run OpenResearch for deep autonomous research
  const searchProvider = (process.env.SEARCH_PROVIDER || 'auto') as string;
  console.log(`[Alba] Running OpenResearch for: ${floor.name} (search: ${searchProvider})`);
  let openResearchResult: OpenResearchResult | undefined;
  try {
    const researchSearchApi = searchProvider === 'auto'
      ? (process.env.TAVILY_API_KEY ? 'tavily' : process.env.BRAVE_SEARCH_API_KEY ? 'brave' : 'duckduckgo')
      : searchProvider;
    openResearchResult = await runOpenResearch(floor.name, {
      iterations: 1, // Single iteration to stay under 60s Vercel limit
      timeout: 20000, // 20s timeout
      searchApi: researchSearchApi,
      searchApiKey: process.env.TAVILY_API_KEY || process.env.BRAVE_SEARCH_API_KEY,
    });
    console.log(`[Alba] OpenResearch complete (confidence: ${(openResearchResult.confidence * 100).toFixed(1)}%)`);
  } catch (err) {
    console.warn(`[Alba] OpenResearch failed:`, err instanceof Error ? err.message : String(err));
    // Continue with best-effort
  }

  // Step 2: Run web search for real-time research
  const webSearchProvider = (searchProvider === 'auto' ? undefined : searchProvider) as WebSearchOptions['provider'] | undefined;
  console.log(`[Alba] Running web search for: ${floor.name} (provider: ${webSearchProvider || 'auto'})`);
  let braveResults: SearchResult[] = [];
  try {
    const searchQuery = `${floor.name} ${floor.description ?? ''} automation implementation best practices`;
    braveResults = await webSearch({ query: searchQuery, count: 5, freshness: 'month', provider: webSearchProvider });
    console.log(`[Alba] Web search complete (${braveResults.length} results)`);
  } catch (err) {
    console.warn(`[Alba] Brave Search failed:`, err instanceof Error ? err.message : String(err));
    // Continue with best-effort
  }

  // Step 3: Gather personal context
  console.log(`[Alba] Loading personal context for customer: ${goal.customerId}`);
  let userContext: PersonalContext | undefined;
  try {
    userContext = await getPersonalContext(goal.customerId);
    console.log(`[Alba] Personal context loaded (${userContext.history.totalBuilds} past builds, ${userContext.history.commonPatterns.length} patterns)`);
  } catch (err) {
    console.warn(`[Alba] Personal context failed:`, err instanceof Error ? err.message : String(err));
    // Continue with best-effort
  }

  // Step 4: Combine all research sources
  console.log(`[Alba] Combining research from all sources...`);
  const combinedResearch = await combineResearch(
    floor.name,
    floor.description,
    goal.customerId,
    openResearchResult,
    braveResults,
    userContext,
  );

  const parts: string[] = [
    `FLOOR ${floor.floorNumber}: ${floor.name}`,
    `Description: ${floor.description ?? 'No description'}`,
    `Success Condition: ${floor.successCondition}`,
    '',
    `CUSTOMER GOAL: ${goal.goalText}`,
    '',
    `BUILDING CONTEXT (prior floors):`,
    buildingContext,
    '',
    `RESEARCH INTELLIGENCE (OpenResearch + Brave Search + Personal Context):`,
    combinedResearch.combinedSummary,
  ];

  if (existingPatterns.length > 0) {
    parts.push('', 'PROVEN AUTOMATION PATTERNS (from intelligence database):');
    for (const p of existingPatterns) {
      parts.push(
        `- [${Math.round(p.confidence * 100)}% confidence] ${p.patternDescription}`,
        `  Implementation: ${p.implementationNotes ?? 'N/A'}`,
        `  Source: ${p.sourceUrl ?? 'customer build'}`,
      );
    }
  }

  if (priorVex1Report) {
    parts.push('', 'PREVIOUS VEX GATE 1 REJECTION (address every issue):', priorVex1Report);
  }

  const albaMessage = parts.join('\n');

  let albaRaw: string;
  try {
    console.log(`[Alba] Generating research report...`);
    albaRaw = await routeAgentCall({
      systemPrompt: ALBA_RESEARCH_PROMPT,
      userMessage: albaMessage,
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 4096,
      agentName: 'Alba',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[StepRunner] Alba failed: ${msg}`);
    await logAgentAction({
      floorId,
      goalId: floor.goalId,
      agentName: 'Alba',
      iteration: iterationCount,
      action: 'research_error',
      outputSummary: msg.slice(0, 2000),
      durationMs: Date.now() - albaStartTime,
    });

    // Check if we should retry
    if (iterationCount < MAX_ITERATIONS) {
      return {
        step: 'alba',
        success: false,
        nextStep: 'alba',
        message: `Alba error: ${msg}. Will retry.`,
        floorId,
        iteration: iterationCount + 1,
      };
    }
    return {
      step: 'alba',
      success: false,
      nextStep: 'done',
      message: `Alba error: ${msg}. Max iterations reached.`,
      floorId,
      iteration: iterationCount,
    };
  }

  const albaResult = parseJSON<AlbaResult>(albaRaw, 'Alba');

  // Validate required fields exist
  if (!albaResult.approach || typeof albaResult.approach !== 'string') {
    console.error('[StepRunner] Alba returned invalid result - missing approach field');
    return {
      step: 'alba',
      success: false,
      nextStep: iterationCount < MAX_ITERATIONS ? 'alba' : 'done',
      message: `Alba error: Invalid response format (missing approach). ${iterationCount < MAX_ITERATIONS ? 'Will retry.' : 'Max iterations reached.'}`,
      floorId,
      iteration: iterationCount < MAX_ITERATIONS ? iterationCount + 1 : iterationCount,
    };
  }

  // PHASE 4: Pattern Matching Validation
  console.log(`[Alba] Running Pattern Matching Validation...`);
  let patternValidation: PatternValidationResult | undefined;
  try {
    patternValidation = await validateAgainstPatterns(
      albaResult,
      floor.name,
      floor.description,
      floor.successCondition,
    );
    console.log(`[Alba] Pattern validation ${patternValidation.passed ? 'PASSED' : 'FAILED'} (confidence: ${(patternValidation.confidence * 100).toFixed(1)}%)`);

    // Log pattern validation warnings
    if (patternValidation.deviations.length > 0) {
      console.warn(`[Alba] Pattern deviations detected:`, patternValidation.deviations);
    }
  } catch (err) {
    console.warn(`[Alba] Pattern validation failed:`, err instanceof Error ? err.message : String(err));
    // Continue with best-effort (don't block on validation failure)
  }

  // PHASE 5: Risk Analysis Validation
  console.log(`[Alba] Running Risk Analysis...`);
  let riskAnalysis: RiskAnalysisResult | undefined;
  try {
    riskAnalysis = await analyzeRisks(
      albaResult,
      floor.name,
      floor.description,
    );
    console.log(`[Alba] Risk analysis ${riskAnalysis.passed ? 'PASSED' : 'FAILED'} (total risk: ${riskAnalysis.totalRiskScore.toFixed(1)}, critical: ${riskAnalysis.criticalRisks.length})`);

    // Log critical risks
    if (riskAnalysis.criticalRisks.length > 0) {
      console.error(`[Alba] CRITICAL RISKS DETECTED:`);
      riskAnalysis.criticalRisks.forEach(risk => {
        console.error(`  - ${risk.description} (severity: ${risk.severity}, score: ${risk.riskScore.toFixed(1)})`);
      });
    }

    // Log high risks
    if (riskAnalysis.highRisks.length > 0) {
      console.warn(`[Alba] High risks detected:`, riskAnalysis.highRisks.map(r => r.description));
    }
  } catch (err) {
    console.warn(`[Alba] Risk analysis failed:`, err instanceof Error ? err.message : String(err));
    // Continue with best-effort (don't block on validation failure)
  }

  // PHASE 6: Swarm Intelligence Validation (combines all three methods)
  console.log(`[Alba] Running Swarm Intelligence Validation...`);
  let swarmValidation: SwarmValidationResult | undefined;
  try {
    swarmValidation = await runSwarmValidation(
      albaResult,
      floor.name,
      floor.description,
      patternValidation,
      riskAnalysis,
    );
    console.log(`[Alba] Swarm validation ${swarmValidation.passed ? 'PASSED' : 'FAILED'} (confidence: ${(swarmValidation.unifiedConfidence * 100).toFixed(1)}%, decision: ${swarmValidation.finalDecision})`);

    // Log final decision
    console.log(`[Alba] Swarm decision: ${swarmValidation.finalDecision.toUpperCase()}`);
    console.log(`[Alba] Reasoning: ${swarmValidation.reasoning}`);

    // Log recommended changes if any
    if (swarmValidation.recommendedChanges.length > 0) {
      console.warn(`[Alba] Recommended changes (${swarmValidation.recommendedChanges.length}):`);
      swarmValidation.recommendedChanges.forEach((change, idx) => {
        console.warn(`  ${idx + 1}. ${change}`);
      });
    }
  } catch (err) {
    console.warn(`[Alba] Swarm validation failed:`, err instanceof Error ? err.message : String(err));
    // Continue with best-effort (don't block on validation failure)
  }

  // Enhance Alba result with research sources and metadata
  const enhancedAlbaResult = {
    ...albaResult,
    sources: [
      ...albaResult.sources,
      ...combinedResearch.allSources.map(s => s.url),
    ],
    researchMetadata: {
      openResearchConfidence: openResearchResult?.confidence || 0,
      openResearchIterations: openResearchResult?.metadata.totalIterations || 0,
      braveSearchResults: braveResults.length,
      personalContextUsed: !!userContext,
      userPreferences: userContext ? {
        language: userContext.preferences.language,
        timezone: userContext.preferences.timezone,
        emailProvider: userContext.preferences.emailProvider,
      } : null,
    },
    patternValidation: patternValidation ? {
      passed: patternValidation.passed,
      confidence: patternValidation.confidence,
      category: patternValidation.category,
      deviationsCount: patternValidation.deviations.length,
      recommendationsCount: patternValidation.recommendations.length,
      matchedPatternsCount: patternValidation.matchedPatterns.length,
    } : null,
    riskAnalysis: riskAnalysis ? {
      passed: riskAnalysis.passed,
      totalRiskScore: riskAnalysis.totalRiskScore,
      criticalRisksCount: riskAnalysis.criticalRisks.length,
      highRisksCount: riskAnalysis.highRisks.length,
      mediumRisksCount: riskAnalysis.mediumRisks.length,
      lowRisksCount: riskAnalysis.lowRisks.length,
      mitigationsCount: riskAnalysis.mitigations.length,
    } : null,
    swarmValidation: swarmValidation ? {
      passed: swarmValidation.passed,
      unifiedConfidence: swarmValidation.unifiedConfidence,
      finalDecision: swarmValidation.finalDecision,
      recommendedChangesCount: swarmValidation.recommendedChanges.length,
      agentDebate: {
        consensus: swarmValidation.agentDebate.consensus,
        finalRecommendation: swarmValidation.agentDebate.finalRecommendation,
        agentCount: swarmValidation.agentDebate.agentOpinions.length,
      },
    } : null,
  };

  await updateFloorStatus(floorId, 'researching', {
    researchOutput: JSON.stringify(enhancedAlbaResult),
    patternValidationReport: patternValidation ? patternValidation.validationReport : null,
    riskAnalysisReport: riskAnalysis ? riskAnalysis.riskReport : null,
    swarmValidationReport: swarmValidation ? swarmValidation.combinedReport : null,
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

  // Log pattern validation action
  if (patternValidation) {
    await logAgentAction({
      floorId,
      goalId: floor.goalId,
      agentName: 'PatternMatcher',
      iteration: iterationCount,
      action: patternValidation.passed ? 'pattern_validation_passed' : 'pattern_validation_failed',
      inputSummary: `Category: ${patternValidation.category || 'unknown'}, Matched: ${patternValidation.matchedPatterns.length} patterns`,
      outputSummary: `Confidence: ${(patternValidation.confidence * 100).toFixed(1)}%, Deviations: ${patternValidation.deviations.length}, Recommendations: ${patternValidation.recommendations.length}`,
      durationMs: 0, // Pattern matching is fast
    });
  }

  // Log risk analysis action
  if (riskAnalysis) {
    await logAgentAction({
      floorId,
      goalId: floor.goalId,
      agentName: 'RiskAnalyzer',
      iteration: iterationCount,
      action: riskAnalysis.passed ? 'risk_analysis_passed' : 'risk_analysis_failed',
      inputSummary: `Total risks: ${riskAnalysis.criticalRisks.length + riskAnalysis.highRisks.length + riskAnalysis.mediumRisks.length + riskAnalysis.lowRisks.length}`,
      outputSummary: `Total risk score: ${riskAnalysis.totalRiskScore.toFixed(1)}, Critical: ${riskAnalysis.criticalRisks.length}, High: ${riskAnalysis.highRisks.length}, Mitigations: ${riskAnalysis.mitigations.length}`,
      durationMs: 0, // Risk analysis is fast
    });
  }

  // Log swarm validation action
  if (swarmValidation) {
    await logAgentAction({
      floorId,
      goalId: floor.goalId,
      agentName: 'SwarmIntelligence',
      iteration: iterationCount,
      action: swarmValidation.passed ? 'swarm_validation_passed' : 'swarm_validation_failed',
      inputSummary: `Decision: ${swarmValidation.finalDecision}, Agents: ${swarmValidation.agentDebate.agentOpinions.length}, Unified confidence: ${(swarmValidation.unifiedConfidence * 100).toFixed(1)}%`,
      outputSummary: `${swarmValidation.reasoning}. Recommended changes: ${swarmValidation.recommendedChanges.length}`,
      durationMs: 0, // Swarm validation is fast
    });
  }

  emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
    floorId,
    agent: 'Alba',
    action: 'research_complete',
    iteration: iterationCount,
    patternValidation: patternValidation ? {
      passed: patternValidation.passed,
      confidence: patternValidation.confidence,
    } : null,
    riskAnalysis: riskAnalysis ? {
      passed: riskAnalysis.passed,
      totalRiskScore: riskAnalysis.totalRiskScore,
      criticalRisks: riskAnalysis.criticalRisks.length,
    } : null,
    swarmValidation: swarmValidation ? {
      passed: swarmValidation.passed,
      unifiedConfidence: swarmValidation.unifiedConfidence,
      finalDecision: swarmValidation.finalDecision,
    } : null,
  });

  return {
    step: 'alba',
    success: true,
    nextStep: 'vex1',
    message: `Alba research complete. Approach: ${albaResult.approach.slice(0, 200)}`,
    floorId,
    iteration: iterationCount,
  };
}

// ============================================================
// Step: Vex Gate 1
// ============================================================

export async function runVex1Step(floorId: string, iteration: number): Promise<StepResult> {
  console.log(`[StepRunner] Vex Gate 1 for floor ${floorId}, iteration ${iteration}`);

  const floor = await getFloor(floorId);
  if (!floor) throw new Error(`Floor not found: ${floorId}`);

  if (!floor.researchOutput) {
    throw new Error(`Floor ${floorId} has no research output. Cannot run Vex Gate 1.`);
  }

  const albaResult = JSON.parse(floor.researchOutput) as AlbaResult;

  await updateFloorStatus(floorId, 'auditing');
  emitEvent(BUILDING_EVENTS.FLOOR_STATUS, { floorId, status: 'auditing', iteration, gate: 1 });

  const vex1StartTime = Date.now();
  const vex1Message = [
    `FLOOR ${floor.floorNumber}: ${floor.name}`,
    `Success Condition: ${floor.successCondition}`,
    '',
    'ALBA RESEARCH REPORT:',
    JSON.stringify(albaResult, null, 2),
  ].join('\n');

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
    iteration,
    action: vex1Result.approved ? 'gate1_approved' : 'gate1_rejected',
    inputSummary: `Research: ${albaResult.approach.slice(0, 500)}`,
    outputSummary: vex1Result.verdict.slice(0, 2000),
    durationMs: Date.now() - vex1StartTime,
  });

  emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
    floorId,
    agent: 'Vex',
    action: vex1Result.approved ? 'gate1_approved' : 'gate1_rejected',
    iteration,
    verdict: vex1Result.verdict,
  });

  if (!vex1Result.approved) {
    console.log(`[StepRunner] Vex Gate 1 REJECTED: ${vex1Result.verdict}`);
    if (iteration < MAX_ITERATIONS) {
      return {
        step: 'vex1',
        success: true,
        nextStep: 'alba',
        message: `Vex Gate 1 rejected. Sending back to Alba. ${vex1Result.verdict}`,
        floorId,
        iteration: iteration + 1,
      };
    }
    return {
      step: 'vex1',
      success: false,
      nextStep: 'done',
      message: `Vex Gate 1 rejected, max iterations reached.`,
      floorId,
      iteration,
    };
  }

  console.log(`[StepRunner] Vex Gate 1 APPROVED`);
  return {
    step: 'vex1',
    success: true,
    nextStep: 'david',
    message: `Vex Gate 1 approved. ${vex1Result.verdict}`,
    floorId,
    iteration,
  };
}

// ============================================================
// Step: David Build
// ============================================================

export async function runDavidStep(floorId: string, iteration: number): Promise<StepResult> {
  console.log(`[StepRunner] David build for floor ${floorId}, iteration ${iteration}`);

  const floor = await getFloor(floorId);
  if (!floor) throw new Error(`Floor not found: ${floorId}`);

  if (!floor.researchOutput) {
    throw new Error(`Floor ${floorId} has no research output. Cannot run David.`);
  }
  if (!floor.vexGate1Report) {
    throw new Error(`Floor ${floorId} has no Vex Gate 1 report. Cannot run David.`);
  }

  const albaResult = JSON.parse(floor.researchOutput) as AlbaResult;
  const vex1Result = JSON.parse(floor.vexGate1Report) as VexGate1Result;
  const buildingContext = await getBuildingContext(floor.goalId);
  const priorVex2Reports = await getPriorVex2Reports(floorId);
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

  await updateFloorStatus(floorId, 'building');
  emitEvent(BUILDING_EVENTS.FLOOR_STATUS, { floorId, status: 'building', iteration });

  const davidStartTime = Date.now();

  // PHASE 7: Generate Prediction Prompt (combines all validation results)
  console.log(`[David] Generating prediction prompt with validation results...`);

  // Extract validation results from enhanced Alba result
  const patternValidation = (albaResult as any).patternValidation;
  const riskAnalysis = (albaResult as any).riskAnalysis;
  const swarmValidation = (albaResult as any).swarmValidation;
  const personalContext = (albaResult as any).researchMetadata?.userPreferences;

  const predictionPrompt = generatePredictionPrompt({
    floorName: floor.name,
    floorDescription: floor.description,
    floorNumber: floor.floorNumber,
    successCondition: floor.successCondition,
    albaApproach: albaResult.approach,
    albaImplementation: albaResult.implementation,
    albaLibraries: albaResult.libraries,
    albaRisks: albaResult.risks,
    albaSources: albaResult.sources,
    albaComplexity: albaResult.complexity,
    patternValidation: patternValidation ? {
      passed: patternValidation.passed,
      confidence: patternValidation.confidence,
      matchedPatterns: [], // Stored in separate report
      deviations: [],
      recommendations: [],
      category: patternValidation.category,
      validationReport: floor.patternValidationReport || '',
    } : undefined,
    riskAnalysis: riskAnalysis ? {
      passed: riskAnalysis.passed,
      totalRiskScore: riskAnalysis.totalRiskScore,
      criticalRisks: [],
      highRisks: [],
      mediumRisks: [],
      lowRisks: [],
      mitigations: [],
      riskReport: floor.riskAnalysisReport || '',
    } : undefined,
    swarmValidation: swarmValidation ? {
      passed: swarmValidation.passed,
      unifiedConfidence: swarmValidation.unifiedConfidence,
      agentDebate: {
        consensus: swarmValidation.agentDebate?.consensus || '',
        agentOpinions: [],
        debateRounds: 2,
        finalRecommendation: swarmValidation.finalDecision,
      },
      finalDecision: swarmValidation.finalDecision,
      reasoning: '',
      combinedReport: floor.swarmValidationReport || '',
      recommendedChanges: [],
    } : undefined,
    goalText: goal.goalText,
    buildingContext: buildingContext,
  });

  const davidMessage = formatForDavid(predictionPrompt);

  console.log(`[David] Prediction prompt generated (confidence: ${(predictionPrompt.metadata.unifiedConfidence * 100).toFixed(1)}%)`);
  console.log(`[David] Constraints: ${predictionPrompt.constraints.length}, Quality Gates: ${predictionPrompt.qualityGates.length}`);

  const davidRaw = await routeAgentCall({
    systemPrompt: DAVID_BUILD_PROMPT,
    userMessage: davidMessage,
    // Use Sonnet for step-based loop — Opus exceeds Vercel Hobby plan's 60s limit.
    // Sonnet 4.5 is fast (~20-30s) and excellent at code generation.
    // The monolithic building-loop.ts still uses Opus for Pro plan users.
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 8192,
    agentName: 'David',
  });

  const davidRawParsed = parseJSON<Record<string, unknown>>(davidRaw, 'David');
  const davidResult = normalizeDavidResult(davidRawParsed);

  // Validate required fields exist
  if (!davidResult.selfAuditReport || typeof davidResult.selfAuditReport !== 'string') {
    console.error('[StepRunner] David returned invalid result - missing selfAuditReport field');
    return {
      step: 'david',
      success: false,
      nextStep: iteration < MAX_ITERATIONS ? 'david' : 'done',
      message: `David error: Invalid response format (missing selfAuditReport). ${iteration < MAX_ITERATIONS ? 'Will retry.' : 'Max iterations reached.'}`,
      floorId,
      iteration: iteration < MAX_ITERATIONS ? iteration + 1 : iteration,
    };
  }

  // Validate entryPoint matches a file name
  if (davidResult.files.length > 0) {
    const fileNames = davidResult.files.map((f) => f.name);
    if (!fileNames.includes(davidResult.entryPoint)) {
      console.log(`[StepRunner] entryPoint "${davidResult.entryPoint}" not in files [${fileNames.join(', ')}], correcting to ${fileNames[0]}`);
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
    iteration,
    action: 'build_complete',
    inputSummary: `Floor ${floor.floorNumber}: ${floor.name} | Approach: ${albaResult.approach.slice(0, 300)}`,
    outputSummary: davidResult.selfAuditReport.slice(0, 2000),
    durationMs: Date.now() - davidStartTime,
  });

  emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
    floorId,
    agent: 'David',
    action: 'build_complete',
    iteration,
  });

  // Syntax validation gate
  if (davidResult.files.length > 0) {
    console.log(`[StepRunner] Running syntax validation on ${davidResult.files.length} file(s)...`);
    const syntaxResult = await validateSyntax(davidResult.files);

    await logAgentAction({
      floorId,
      goalId: floor.goalId,
      agentName: 'SyntaxValidator',
      iteration,
      action: syntaxResult.valid ? 'syntax_passed' : 'syntax_failed',
      inputSummary: `Files: ${syntaxResult.checkedFiles.join(', ')}`,
      outputSummary: syntaxResult.valid
        ? `All ${syntaxResult.checkedFiles.length} file(s) passed syntax check`
        : `Syntax errors: ${syntaxResult.errors.join('; ')}`,
      durationMs: 0,
    });

    if (!syntaxResult.valid) {
      davidResult.syntaxValid = false;
      emitEvent(BUILDING_EVENTS.SYNTAX_INVALID, { floorId, errors: syntaxResult.errors });
      console.log(`[StepRunner] Syntax validation FAILED: ${syntaxResult.errors.join('; ')}`);

      // Store as Vex2 rejection so David sees it on retry
      await updateFloorStatus(floorId, 'auditing', {
        vexGate2Report: JSON.stringify({
          approved: false,
          verdict: `Syntax errors found: ${syntaxResult.errors.join('; ')}`,
          issues: syntaxResult.errors,
          specificFixes: syntaxResult.errors.map((e) => `Fix syntax error: ${e}`),
          qualityScore: 0,
        }),
        buildOutput: serializeDavidResult(davidResult),
      } as Partial<Floor>);

      return {
        step: 'david',
        success: true,
        nextStep: iteration < MAX_ITERATIONS ? 'alba' : 'done',
        message: `Syntax validation failed. ${syntaxResult.errors.join('; ')}`,
        floorId,
        iteration: iteration < MAX_ITERATIONS ? iteration + 1 : iteration,
      };
    }

    davidResult.syntaxValid = true;
    emitEvent(BUILDING_EVENTS.SYNTAX_VALID, { floorId, files: syntaxResult.checkedFiles });
    console.log(`[StepRunner] Syntax validation PASSED`);

    // Update stored buildOutput with syntaxValid flag
    await updateFloorStatus(floorId, 'building', {
      buildOutput: serializeDavidResult(davidResult),
    } as Partial<Floor>);
  }

  return {
    step: 'david',
    success: true,
    nextStep: 'vex2',
    message: `David build complete. Entry: ${davidResult.entryPoint}. Files: ${davidResult.files.map(f => f.name).join(', ')}`,
    floorId,
    iteration,
  };
}

// ============================================================
// Step: Vex Gate 2
// ============================================================

export async function runVex2Step(floorId: string, iteration: number): Promise<StepResult> {
  console.log(`[StepRunner] Vex Gate 2 for floor ${floorId}, iteration ${iteration}`);

  const floor = await getFloor(floorId);
  if (!floor) throw new Error(`Floor not found: ${floorId}`);

  if (!floor.researchOutput || !floor.buildOutput) {
    throw new Error(`Floor ${floorId} missing research or build output. Cannot run Vex Gate 2.`);
  }

  const albaResult = JSON.parse(floor.researchOutput) as AlbaResult;
  const davidResult = normalizeDavidResult(JSON.parse(floor.buildOutput));

  await updateFloorStatus(floorId, 'auditing');
  emitEvent(BUILDING_EVENTS.FLOOR_STATUS, { floorId, status: 'auditing', iteration, gate: 2 });

  const vex2StartTime = Date.now();
  const vex2Message = [
    `FLOOR ${floor.floorNumber}: ${floor.name}`,
    `Success Condition: ${floor.successCondition}`,
    '',
    'ALBA RESEARCH REPORT:',
    JSON.stringify(albaResult, null, 2),
    '',
    'DAVID BUILD OUTPUT:',
    JSON.stringify(davidResult, null, 2),
  ].join('\n');

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
    iteration,
    action: vex2Result.approved ? 'gate2_approved' : 'gate2_rejected',
    inputSummary: `Build: ${davidResult.entryPoint}`,
    outputSummary: vex2Result.verdict.slice(0, 2000),
    durationMs: Date.now() - vex2StartTime,
  });

  emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
    floorId,
    agent: 'Vex',
    action: vex2Result.approved ? 'gate2_approved' : 'gate2_rejected',
    iteration,
    verdict: vex2Result.verdict,
    qualityScore: vex2Result.qualityScore,
  });

  if (!vex2Result.approved) {
    console.log(`[StepRunner] Vex Gate 2 REJECTED: ${vex2Result.verdict}`);

    // Pattern failure feedback after 2+ rejections
    try {
      const category = detectCategory(floor.name, floor.description ?? '', floor.successCondition);
      if (category && iteration > 2) {
        const patterns = await getTopPatterns(category, 1, 0.6);
        if (patterns.length > 0) {
          await recordPatternFailure(patterns[0].id);
        }
      }
    } catch {
      // best-effort
    }

    if (iteration < MAX_ITERATIONS) {
      return {
        step: 'vex2',
        success: true,
        nextStep: 'alba',
        message: `Vex Gate 2 rejected. Back to Alba. ${vex2Result.verdict}`,
        floorId,
        iteration: iteration + 1,
      };
    }
    return {
      step: 'vex2',
      success: false,
      nextStep: 'done',
      message: `Vex Gate 2 rejected, max iterations reached.`,
      floorId,
      iteration,
    };
  }

  console.log(`[StepRunner] Vex Gate 2 APPROVED`);
  return {
    step: 'vex2',
    success: true,
    nextStep: 'elira',
    message: `Vex Gate 2 approved. Quality: ${vex2Result.qualityScore}`,
    floorId,
    iteration,
  };
}

// ============================================================
// Step: Elira Review
// ============================================================

export async function runEliraStep(floorId: string, iteration: number): Promise<StepResult> {
  console.log(`[StepRunner] Elira review for floor ${floorId}, iteration ${iteration}`);

  const floor = await getFloor(floorId);
  if (!floor) throw new Error(`Floor not found: ${floorId}`);

  if (!floor.buildOutput) {
    throw new Error(`Floor ${floorId} has no build output. Cannot run Elira review.`);
  }

  const davidResult = normalizeDavidResult(JSON.parse(floor.buildOutput));
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
  const buildingContext = await getBuildingContext(floor.goalId);

  const eliraStartTime = Date.now();
  const eliraMessage = [
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
    iteration,
    action: eliraResult.verdict === 'approved' ? 'floor_approved' : 'floor_not_ready',
    inputSummary: `Floor ${floor.floorNumber}: ${floor.name}`,
    outputSummary: eliraResult.reason.slice(0, 2000),
    durationMs: Date.now() - eliraStartTime,
  });

  emitEvent(BUILDING_EVENTS.AGENT_ACTION, {
    floorId,
    agent: 'Elira',
    action: eliraResult.verdict,
    iteration,
    reason: eliraResult.reason,
  });

  if (eliraResult.verdict !== 'approved') {
    console.log(`[StepRunner] Elira NOT READY: ${eliraResult.reason}`);
    if (iteration < MAX_ITERATIONS) {
      return {
        step: 'elira',
        success: true,
        nextStep: 'alba',
        message: `Elira not ready. Back to Alba. ${eliraResult.reason}`,
        floorId,
        iteration: iteration + 1,
      };
    }
    return {
      step: 'elira',
      success: false,
      nextStep: 'done',
      message: `Elira not ready, max iterations reached.`,
      floorId,
      iteration,
    };
  }

  console.log(`[StepRunner] Elira APPROVED`);
  return {
    step: 'elira',
    success: true,
    nextStep: 'finalize',
    message: `Elira approved. ${eliraResult.reason}`,
    floorId,
    iteration,
  };
}

// ============================================================
// Step: Finalize (floor goes live, start next floor)
// ============================================================

export async function runFinalizeStep(floorId: string, iteration: number): Promise<StepResult> {
  console.log(`[StepRunner] Finalize for floor ${floorId}`);

  const floor = await getFloor(floorId);
  if (!floor) throw new Error(`Floor not found: ${floorId}`);

  if (!floor.buildOutput) {
    throw new Error(`Floor ${floorId} has no build output. Cannot finalize.`);
  }

  const davidResult = normalizeDavidResult(JSON.parse(floor.buildOutput));
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

  // Mark floor live
  console.log(`[StepRunner] Floor ${floor.floorNumber} "${floor.name}" is now LIVE`);
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

  // Stripe billing (best-effort)
  try {
    const { getSubscription, addFloorToSubscription } = await import('./subscription-manager');
    const sub = await getSubscription(floor.goalId);
    if (sub?.stripeSubscriptionId && sub.status === 'active') {
      await addFloorToSubscription(floor.goalId);
    }
  } catch (err) {
    console.error('[StepRunner] Floor billing failed:', err);
  }

  // Pattern feedback (best-effort)
  let category: string | null = null;
  try {
    category = detectCategory(floor.name, floor.description ?? '', floor.successCondition);
    if (category) {
      const patterns = await getTopPatterns(category, 1, 0.6);
      if (patterns.length > 0) {
        await recordPatternSuccess(patterns[0].id);
      }
      await saveCustomerBuildPattern({
        category,
        patternDescription: `${floor.name}: ${floor.successCondition}`,
        implementationNotes: davidResult.handoffNotes.slice(0, 500),
      });
    }
  } catch {
    // best-effort
  }

  // Sync workspace files (best-effort)
  try {
    const { syncToFiles } = await import('@/lib/workspace/workspace-manager');
    await syncToFiles(floor.goalId);
  } catch {
    // best-effort
  }

  // Write floor output to customer workspace (best-effort)
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
    // best-effort
  }

  // Check for next floor
  const nextFloor = await getNextFloor(floor.goalId, floor.floorNumber);

  if (nextFloor) {
    console.log(`[StepRunner] Activating next floor: ${nextFloor.floorNumber} "${nextFloor.name}"`);
    await updateFloorStatus(nextFloor.id, 'researching');

    emitEvent(BUILDING_EVENTS.FLOOR_STATUS, {
      floorId: nextFloor.id,
      status: 'researching',
      floorNumber: nextFloor.floorNumber,
      name: nextFloor.name,
    });

    // Chain to alba step for the next floor (new invocation)
    // This is returned so the API route can use waitUntil
    return {
      step: 'finalize',
      success: true,
      nextStep: 'alba',
      message: `Floor ${floor.floorNumber} live. Next: Floor ${nextFloor.floorNumber} "${nextFloor.name}"`,
      floorId: nextFloor.id, // NOTE: switching to NEXT floor
      iteration: 1,
    };
  }

  // Last floor — goal met
  console.log(`[StepRunner] All floors complete. Goal met!`);
  await updateGoalStatus(floor.goalId, 'goal_met');
  notify(`🏆 *Goal met!* All floors complete for "${goal.goalText.slice(0, 80)}"`);

  emitEvent(BUILDING_EVENTS.GOAL_MET, {
    goalId: floor.goalId,
    goalText: goal.goalText,
  });

  try {
    const { syncToFiles } = await import('@/lib/workspace/workspace-manager');
    await syncToFiles(floor.goalId);
  } catch {
    // best-effort
  }

  return {
    step: 'finalize',
    success: true,
    nextStep: 'done',
    message: `All floors complete. Goal met!`,
    floorId,
    iteration,
  };
}

// ============================================================
// Step dispatcher
// ============================================================

export async function runStep(
  floorId: string,
  step: StepName,
  iteration: number,
): Promise<StepResult> {
  switch (step) {
    case 'alba':
      return runAlbaStep(floorId, iteration);
    case 'vex1':
      return runVex1Step(floorId, iteration);
    case 'david':
      return runDavidStep(floorId, iteration);
    case 'vex2':
      return runVex2Step(floorId, iteration);
    case 'elira':
      return runEliraStep(floorId, iteration);
    case 'finalize':
      return runFinalizeStep(floorId, iteration);
    default:
      throw new Error(`Unknown step: ${step}`);
  }
}

// ============================================================
// Handle max iterations exceeded
// ============================================================

export async function markFloorBlocked(floorId: string): Promise<void> {
  const floor = await getFloor(floorId);
  if (!floor) return;

  console.error(`[StepRunner] Floor ${floorId} exceeded max iterations (${MAX_ITERATIONS}). Marking blocked.`);
  await updateFloorStatus(floorId, 'blocked');
  notify(`🚫 *Floor ${floor.floorNumber}* "${floor.name}" *blocked* — exceeded ${MAX_ITERATIONS} iterations`);

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
}
