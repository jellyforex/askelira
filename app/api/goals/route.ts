import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    try {
      const { sql } = await import('@vercel/postgres');

      // Require authentication -- unauthenticated users get empty list
      if (!session?.user?.email) {
        return NextResponse.json({ goals: [] });
      }

      const result = await sql`
        SELECT
          g.id,
          g.customer_id AS "customerId",
          g.goal_text AS "goalText",
          g.status,
          g.building_summary AS "buildingSummary",
          g.created_at AS "createdAt",
          g.updated_at AS "updatedAt",
          COUNT(f.id)::int AS "floorCount",
          COUNT(CASE WHEN f.status = 'live' THEN 1 END)::int AS "liveFloors"
        FROM goals g
        LEFT JOIN floors f ON f.goal_id = g.id
        WHERE g.customer_id = ${session.user.email}
        GROUP BY g.id
        ORDER BY g.created_at DESC
      `;
      const rows = result.rows;

      const goals = rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        goalText: r.goalText,
        status: r.status,
        buildingSummary: r.buildingSummary,
        floorCount: r.floorCount,
        liveFloors: r.liveFloors,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
      }));

      return NextResponse.json({ goals });
    } catch (dbErr: unknown) {
      const message = dbErr instanceof Error ? dbErr.message : 'Database error';
      console.error('[API /goals] DB error:', message);

      // Graceful fallback: return empty array if DB is unavailable (local dev)
      return NextResponse.json({ goals: [] });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /goals]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
