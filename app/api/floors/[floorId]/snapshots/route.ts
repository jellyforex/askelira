import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: { floorId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
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
      const { getFloorSnapshots, getFloor } = await import(
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
