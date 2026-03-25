import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth-helpers';

export async function GET(
  req: NextRequest,
  { params }: { params: { floorId: string } },
) {
  try {
    // Unified auth: support both NextAuth session (web) and header-based auth (CLI)
    const auth = await authenticate(req);
    if (!auth.authenticated || !auth.customerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const floorId = params.floorId;

    if (!floorId) {
      return NextResponse.json(
        { error: 'Floor ID is required' },
        { status: 400 },
      );
    }

    try {
      const { getFloorSnapshots, getFloor, getGoal } = await import(
        '@/lib/building-manager'
      );

      // Verify floor exists
      const floor = await getFloor(floorId);
      if (!floor) {
        return NextResponse.json(
          { error: 'Floor not found' },
          { status: 404 },
        );
      }

      // Verify ownership via goal
      const goal = await getGoal(floor.goalId);
      if (goal.customerId !== auth.customerId) {
        return NextResponse.json({ error: 'Floor not found' }, { status: 404 });
      }

      const snapshots = await getFloorSnapshots(floorId);

      return NextResponse.json({
        floorId,
        snapshots: snapshots.map((s) => ({
          id: s.id,
          reason: s.reason,
          status: s.status,
          iterationCount: s.iterationCount,
          createdAt: s.createdAt.toISOString(),
        })),
      });
    } catch (dbErr: unknown) {
      const message =
        dbErr instanceof Error ? dbErr.message : 'Database error';
      console.error(
        '[API /floors/[floorId]/snapshots] Error:',
        message,
      );
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /floors/[floorId]/snapshots]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
