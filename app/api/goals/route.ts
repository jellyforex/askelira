import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth-helpers';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    // Unified auth: support both NextAuth session (web) and header-based auth (CLI)
    const auth = await authenticate(req);

    try {
      const { sql } = await import('@vercel/postgres');

      // Require authentication -- unauthenticated users get empty list
      if (!auth.authenticated || !auth.customerId) {
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
        WHERE g.customer_id = ${auth.customerId}
          AND g.deleted_at IS NULL
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
      logger.error('DB error listing goals', { endpoint: 'GET /api/goals' }, dbErr instanceof Error ? dbErr : undefined);

      // Graceful fallback: return empty array if DB is unavailable (local dev)
      return NextResponse.json({ goals: [] });
    }
  } catch (err: unknown) {
    logger.error('Error in goals list', { endpoint: 'GET /api/goals' }, err instanceof Error ? err : undefined);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
