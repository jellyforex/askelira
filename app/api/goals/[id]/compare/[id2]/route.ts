/**
 * Build Comparison Endpoint — Feature 36 (Steven Gamma)
 *
 * GET /api/goals/[id]/compare/[id2]
 * Returns side-by-side comparison of two builds.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; id2: string } },
) {
  try {
    const { getGoal, getRecentLogs } = await import('@/lib/building-manager');

    const [goal1, goal2] = await Promise.all([
      getGoal(params.id),
      getGoal(params.id2),
    ]);

    const [logs1, logs2] = await Promise.all([
      getRecentLogs(params.id, 200),
      getRecentLogs(params.id2, 200),
    ]);

    const totalTime = (logs: typeof logs1) => {
      if (logs.length < 2) return 0;
      const sorted = logs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      return sorted[sorted.length - 1].timestamp.getTime() - sorted[0].timestamp.getTime();
    };

    const agentsUsed = (logs: typeof logs1) => {
      return [...new Set(logs.map((l) => l.agentName))];
    };

    return NextResponse.json({
      comparison: {
        goal1: {
          id: goal1.id,
          goalText: goal1.goalText.slice(0, 200),
          status: goal1.status,
          floorCount: goal1.floors.length,
          liveFloors: goal1.floors.filter((f) => f.status === 'live').length,
          totalTimeMs: totalTime(logs1),
          agentsUsed: agentsUsed(logs1),
          totalLogs: logs1.length,
        },
        goal2: {
          id: goal2.id,
          goalText: goal2.goalText.slice(0, 200),
          status: goal2.status,
          floorCount: goal2.floors.length,
          liveFloors: goal2.floors.filter((f) => f.status === 'live').length,
          totalTimeMs: totalTime(logs2),
          agentsUsed: agentsUsed(logs2),
          totalLogs: logs2.length,
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
