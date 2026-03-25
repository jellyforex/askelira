/**
 * Health check endpoint -- Updated by Steven Delta SD-007, Phase 5
 * Returns server status, uptime, and database connectivity.
 */
import { NextResponse } from 'next/server';
import packageJson from '@/package.json';

export async function GET() {
  const health: Record<string, unknown> = {
    status: 'ok',
    service: 'AskElira 2.1',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: packageJson.version,
    environment: process.env.NODE_ENV || 'unknown',
  };

  // Phase 5: Memory usage
  const memUsage = process.memoryUsage();
  health.memory = {
    heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
    rssMB: Math.round(memUsage.rss / 1024 / 1024),
  };

  // SD-007: Database health check
  try {
    const { sql } = await import('@vercel/postgres');
    const start = Date.now();
    await sql`SELECT 1`;
    health.database = {
      status: 'connected',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    // Phase 5.2: Do not expose DB error details in production
    health.database = {
      status: 'disconnected',
      ...(process.env.NODE_ENV !== 'production' && {
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
    };
    health.status = 'degraded';
  }

  // Phase 5: Database pool stats
  try {
    const { getPoolStats } = await import('@/lib/db-pool');
    health.databasePool = getPoolStats();
  } catch {
    // db-pool not available
  }

  // Feature 30: Gateway health info
  try {
    const { getGatewayClient } = await import('@/lib/gateway-client');
    const client = getGatewayClient();
    if (client) {
      health.gateway = client.getHealthInfo();
    } else {
      health.gateway = { status: 'not_configured' };
    }
  } catch {
    health.gateway = { status: 'unavailable' };
  }

  // Feature 30: Routing metrics
  try {
    const { getRoutingMetrics } = await import('@/lib/agent-router');
    health.routing = getRoutingMetrics();
  } catch {
    // agent-router not available
  }

  // Phase 5: Check critical environment variables
  // Phase 5.2: Do not expose specific var names in production (information disclosure)
  const requiredEnvVars = [
    'DATABASE_URL',
    'NEXTAUTH_SECRET',
    'ANTHROPIC_API_KEY',
  ];
  const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);

  if (missingEnvVars.length > 0) {
    health.environment_vars = {
      status: 'missing',
      count: missingEnvVars.length,
      // Only show names in development
      ...(process.env.NODE_ENV !== 'production' && { missing: missingEnvVars }),
    };
    health.status = 'degraded';
  } else {
    health.environment_vars = {
      status: 'ok',
      count: requiredEnvVars.length,
    };
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  return NextResponse.json(health, { status: statusCode });
}
