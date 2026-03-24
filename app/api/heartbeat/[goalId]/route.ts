import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: { goalId: string } },
) {
  try {
    const goalId = params.goalId;

    if (!goalId) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 },
      );
    }

    try {
      const { getHeartbeatStatus } = await import('@/lib/heartbeat');
      const { getRecentLogs } = await import('@/lib/building-manager');

      const status = getHeartbeatStatus(goalId);

      // Get recent heartbeat-related logs
      const allLogs = await getRecentLogs(goalId, 50);
      const heartbeatLogs = allLogs
        .filter(
          (l) =>
            l.agentName === 'Steven' ||
            l.action.startsWith('heartbeat_') ||
            l.action === 'escalation_report' ||
            l.action === 'escalation_verdict' ||
            l.action === 'automation_suggestion',
        )
        .slice(0, 20);

      return NextResponse.json({
        status: {
          goalId: status.goalId,
          active: status.active,
          intervalMs: status.intervalMs,
          liveFloors: status.liveFloors,
          lastCheckedAt: status.lastCheckedAt?.toISOString() ?? null,
          nextCheckAt: status.nextCheckAt?.toISOString() ?? null,
        },
        recentLogs: heartbeatLogs.map((l) => ({
          id: l.id,
          floorId: l.floorId,
          agentName: l.agentName,
          action: l.action,
          outputSummary: l.outputSummary,
          timestamp: l.timestamp.toISOString(),
        })),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Database error';
      console.error('[API /heartbeat/[goalId]] Error:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /heartbeat/[goalId]]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { goalId: string } },
) {
  try {
    const goalId = params.goalId;

    if (!goalId) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 },
      );
    }

    // Rate limit: 20/hour per goalId
    const { checkRateLimit } = await import('@/lib/rate-limiter');
    const rateCheck = checkRateLimit(`heartbeat:${goalId}`, 20, 3600000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        { status: 429 },
      );
    }

    try {
      const { checkFloor } = await import('@/lib/heartbeat');
      const { getLiveFloors } = await import('@/lib/building-manager');

      const liveFloors = await getLiveFloors(goalId);

      if (liveFloors.length === 0) {
        return NextResponse.json({
          goalId,
          message: 'No live floors to check',
          results: [],
        });
      }

      const results: Array<{
        floorId: string;
        floorNumber: number;
        name: string;
        result: unknown;
        error?: string;
      }> = [];

      for (const floor of liveFloors) {
        try {
          const result = await checkFloor(floor.id);
          results.push({
            floorId: floor.id,
            floorNumber: floor.floorNumber,
            name: floor.name,
            result,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Check failed';
          results.push({
            floorId: floor.id,
            floorNumber: floor.floorNumber,
            name: floor.name,
            result: null,
            error: message,
          });
        }
      }

      return NextResponse.json({
        goalId,
        message: `Checked ${liveFloors.length} live floor(s)`,
        results,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Database error';
      console.error('[API /heartbeat/[goalId]] POST Error:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /heartbeat/[goalId]]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
