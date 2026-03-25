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

    try {
      const { stopHeartbeat } = await import('@/lib/heartbeat');
      stopHeartbeat(goalId);

      return NextResponse.json({
        stopped: true,
        goalId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to stop heartbeat';
      console.error('[API /heartbeat/[goalId]/stop] Error:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /heartbeat/[goalId]/stop]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
