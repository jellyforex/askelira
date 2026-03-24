/**
 * Agent Router — Unified agent invocation layer
 *
 * Decides whether to route agent calls through the OpenClaw Gateway
 * or directly to the Anthropic API based on configuration and health.
 *
 * Routing modes (AGENT_ROUTING_MODE env var):
 *   'gateway'      — Prefer gateway, fallback to direct API on failure (default)
 *   'direct'       — Always use direct Anthropic API
 *   'gateway-only' — Fail if gateway is unavailable
 */

import { getGatewayClient, connectGateway, type InvokeAgentParams } from './gateway-client';
import { callClaudeWithSystem, callClaudeWithTools } from './openclaw-client';
import { GATEWAY_EVENTS } from './events';

// ============================================================
// Types
// ============================================================

export type AgentRoutingMode = 'gateway' | 'direct' | 'gateway-only';

export interface RouteAgentCallParams {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  maxTokens?: number;
  tools?: unknown[];
  agentName?: string;
  timeoutMs?: number;
}

// ============================================================
// Configuration
// ============================================================

// Feature 27: Re-read AGENT_ROUTING_MODE on each call (hot-reload)
function getRoutingMode(): AgentRoutingMode {
  // Always read fresh from env (not cached at import time)
  const mode = process.env.AGENT_ROUTING_MODE || 'gateway';
  if (mode === 'direct' || mode === 'gateway-only' || mode === 'gateway') {
    return mode;
  }
  return 'gateway';
}

// ============================================================
// Metrics (in-memory, reported via heartbeat)
// ============================================================

const routingMetrics = {
  gatewayRequests: 0,
  directRequests: 0,
  gatewaySuccesses: 0,
  gatewayFailures: 0,
  directSuccesses: 0,
  directFailures: 0,
  fallbacksUsed: 0,
};

export function getRoutingMetrics() {
  return { ...routingMetrics };
}

// Feature 29: Save routing metrics to DB per build
export async function saveRoutingMetrics(goalId: string): Promise<void> {
  try {
    const { logAgentAction } = await import('./building-manager');
    await logAgentAction({
      goalId,
      agentName: 'System',
      action: 'routing_metrics',
      outputSummary: JSON.stringify(routingMetrics),
    });
  } catch {
    // best-effort
  }
}

// ============================================================
// Main routing function
// ============================================================

/**
 * Route an agent call through the gateway or direct to Anthropic API.
 * Returns the raw response string from the agent.
 */
export async function routeAgentCall(params: RouteAgentCallParams): Promise<string> {
  const mode = getRoutingMode();
  const label = params.agentName || 'Agent';

  // Direct mode — always use Anthropic API
  if (mode === 'direct') {
    return callDirect(params);
  }

  // Gateway or gateway-only mode — try gateway first
  const client = getGatewayClient();

  // If no gateway configured, check mode
  if (!client) {
    if (mode === 'gateway-only') {
      throw new Error(`[AgentRouter] Gateway not configured (OPENCLAW_GATEWAY_URL not set) but AGENT_ROUTING_MODE=gateway-only`);
    }
    // Default gateway mode with no URL — use direct
    return callDirect(params);
  }

  // Try to connect if not connected
  if (!client.isConnected()) {
    try {
      await connectGateway();
    } catch {
      // Connection failed — handled below
    }
  }

  // Check health (connected + circuit breaker)
  if (!client.isHealthy()) {
    if (mode === 'gateway-only') {
      const status = client.getStatus();
      throw new Error(`[AgentRouter] Gateway is ${status} but AGENT_ROUTING_MODE=gateway-only`);
    }

    console.log(`[AgentRouter] Gateway unhealthy (${client.getStatus()}), using direct API for ${label}`);
    routingMetrics.fallbacksUsed++;
    return callDirect(params);
  }

  // Gateway is healthy — route through it
  try {
    routingMetrics.gatewayRequests++;
    const result = await client.invokeAgent({
      systemPrompt: params.systemPrompt,
      userMessage: params.userMessage,
      model: params.model,
      maxTokens: params.maxTokens,
      tools: params.tools,
      agentName: params.agentName,
      timeoutMs: params.timeoutMs,
    });
    routingMetrics.gatewaySuccesses++;
    return result;
  } catch (err) {
    routingMetrics.gatewayFailures++;

    if (mode === 'gateway-only') {
      throw err;
    }

    // Fallback to direct API
    console.warn(`[AgentRouter] Gateway call failed for ${label}, falling back to direct API:`, err instanceof Error ? err.message : String(err));
    routingMetrics.fallbacksUsed++;
    return callDirect(params);
  }
}

// ============================================================
// Direct API path
// ============================================================

async function callDirect(params: RouteAgentCallParams): Promise<string> {
  const label = params.agentName || 'Agent';
  routingMetrics.directRequests++;

  try {
    let result: string;

    if (params.tools && params.tools.length > 0) {
      result = await callClaudeWithTools({
        systemPrompt: params.systemPrompt,
        userMessage: params.userMessage,
        model: params.model,
        maxTokens: params.maxTokens,
        tools: params.tools,
      });
    } else {
      result = await callClaudeWithSystem({
        systemPrompt: params.systemPrompt,
        userMessage: params.userMessage,
        model: params.model,
        maxTokens: params.maxTokens,
      });
    }

    routingMetrics.directSuccesses++;
    return result;
  } catch (err) {
    routingMetrics.directFailures++;
    throw err;
  }
}
