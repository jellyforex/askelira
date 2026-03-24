/**
 * Build Timeline Endpoint — Feature 32 (Steven Gamma)
 *
 * GET /api/goals/[id]/timeline
 * Returns agent start/end times for the build.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const goalId = params.id;

  try {
    const { getRecentLogs, getAllFloors } = await import('@/lib/building-manager');

    const floors = await getAllFloors(goalId);
    const logs = await getRecentLogs(goalId, 200);

    // Build timeline from agent logs
    const timeline = logs
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((log) => ({
        timestamp: log.timestamp.toISOString(),
        agent: log.agentName,
        action: log.action,
        floorId: log.floorId,
        durationMs: log.durationMs,
        tokensUsed: log.tokensUsed,
        summary: log.outputSummary?.slice(0, 200) || null,
      }));

    // Calculate per-agent totals
    const agentTotals: Record<string, { calls: number; totalMs: number; totalTokens: number }> = {};
    for (const log of logs) {
      if (!agentTotals[log.agentName]) {
        agentTotals[log.agentName] = { calls: 0, totalMs: 0, totalTokens: 0 };
      }
      agentTotals[log.agentName].calls++;
      agentTotals[log.agentName].totalMs += log.durationMs;
      agentTotals[log.agentName].totalTokens += log.tokensUsed;
    }

    return NextResponse.json({
      goalId,
      floorCount: floors.length,
      totalLogs: logs.length,
      timeline,
      agentTotals,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
