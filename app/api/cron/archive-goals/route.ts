/**
 * Goal Archiving Cron -- Steven Delta SD-004
 *
 * POST /api/cron/archive-goals
 * Archives goals older than 90 days that are in terminal states.
 * Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  // Phase 5.2: Fixed CRON_SECRET check -- must be set AND match
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('CRON_SECRET not configured', { endpoint: '/api/cron/archive-goals' });
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  // Check both authorization header (Vercel cron) and x-cron-secret (manual)
  const authHeader = req.headers.get('authorization');
  const cronHeader = req.headers.get('x-cron-secret');
  const isAuthorized =
    authHeader === `Bearer ${cronSecret}` ||
    cronHeader === cronSecret;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { sql } = await import('@vercel/postgres');

    // Phase 5.2: Fixed SQL -- INTERVAL cannot be parameterized.
    // Use a computed cutoff date instead.
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    const { rowCount } = await sql`
      UPDATE goals
      SET archived_at = NOW()
      WHERE archived_at IS NULL
        AND deleted_at IS NULL
        AND status IN ('goal_met', 'blocked')
        AND updated_at < ${cutoffDate.toISOString()}
    `;

    const archived = rowCount ?? 0;
    logger.info(`Archived ${archived} goals older than 90 days`, { endpoint: '/api/cron/archive-goals' });

    return NextResponse.json({ archived, cutoffDays: 90 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Archive failed';
    logger.error('Archive failed', { endpoint: '/api/cron/archive-goals' }, err instanceof Error ? err : undefined);
    return NextResponse.json({ error: 'Archive failed' }, { status: 500 });
  }
}
