import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth-helpers';

export async function POST(
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

    const body = await req.json().catch(() => ({}));
    const { snapshotId } = body as { snapshotId?: string };

    try {
      const {
        getFloor,
        getGoal,
        rollbackFloor,
        getFloorSnapshots,
        logAgentAction,
      } = await import('@/lib/building-manager');

      // Load floor
      const floor = await getFloor(floorId);
      if (!floor) {
        return NextResponse.json(
          { error: 'Floor not found' },
          { status: 404 },
        );
      }

      // Verify goal ownership
      try {
        const goal = await getGoal(floor.goalId);
        if (goal.customerId !== auth.customerId) {
          return NextResponse.json({ error: 'Floor not found' }, { status: 404 });
        }
      } catch {
        return NextResponse.json(
          { error: 'Goal not found for this floor' },
          { status: 404 },
        );
      }

      // Determine which snapshot to rollback to
      let targetSnapshotId: string;

      if (snapshotId) {
        targetSnapshotId = snapshotId;
      } else {
        // Use the most recent snapshot
        const snapshots = await getFloorSnapshots(floorId);
        if (snapshots.length === 0) {
          return NextResponse.json(
            { error: 'No snapshots available for this floor' },
            { status: 404 },
          );
        }
        targetSnapshotId = snapshots[0].id;
      }

      // Perform the rollback
      await rollbackFloor(floorId, targetSnapshotId);

      // Log the rollback
      await logAgentAction({
        floorId,
        goalId: floor.goalId,
        agentName: 'System',
        action: 'floor_rolled_back',
        outputSummary: `Rolled back to snapshot ${targetSnapshotId}`,
      });

      return NextResponse.json({
        floorId,
        snapshotId: targetSnapshotId,
        message: `Floor rolled back to snapshot ${targetSnapshotId}`,
      });
    } catch (dbErr: unknown) {
      const message = dbErr instanceof Error ? dbErr.message : 'Database error';
      console.error('[API /floors/[floorId]/rollback] Error:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /floors/[floorId]/rollback]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
