import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth-helpers';

export async function POST(
  req: NextRequest,
  { params }: { params: { goalId: string } },
) {
  try {
    // Unified auth: support both NextAuth session (web) and header-based auth (CLI)
    const auth = await authenticate(req);
    if (!auth.authenticated || !auth.customerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const goalId = params.goalId;

    if (!goalId) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 },
      );
    }

    // Parse optional intervalMs from request body
    let intervalMs = 300_000; // default 5 minutes
    try {
      const body = await req.json();
      if (body.intervalMs != null) {
        const parsed = Number(body.intervalMs);
        if (isNaN(parsed) || parsed < 30_000 || parsed > 86_400_000) {
          return NextResponse.json(
            {
              error:
                'intervalMs must be between 30000 (30s) and 86400000 (24h)',
            },
            { status: 400 },
          );
        }
        intervalMs = parsed;
      }
    } catch {
      // No body or invalid JSON — use defaults
    }

    try {
      // Verify ownership
      const { getGoal } = await import('@/lib/building-manager');
      const goal = await getGoal(goalId);
      if (goal.customerId !== auth.customerId) {
        return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
      }

      const { startHeartbeat } = await import('@/lib/heartbeat');
      startHeartbeat(goalId, intervalMs);

      return NextResponse.json({
        started: true,
        goalId,
        intervalMs,
        message: `Heartbeat started for goal ${goalId} with ${intervalMs}ms interval`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start heartbeat';
      console.error('[API /heartbeat/[goalId]/start] Error:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /heartbeat/[goalId]/start]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
