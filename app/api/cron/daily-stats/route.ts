/**
 * Daily Build Stats Cron — Feature 38 (Steven Gamma)
 *
 * GET /api/cron/daily-stats
 * Protected by CRON_SECRET. Queries yesterday's builds, computes stats, sends to Telegram.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  // Phase 5.2: Fixed auth -- removed query string auth (leaks secret in URL/logs).
  // Accept authorization header (Vercel cron) or x-cron-secret header (manual).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

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
    const { notify } = await import('@/lib/notify');

    // Yesterday's date range
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const startOfDay = new Date(yesterday);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(yesterday);
    endOfDay.setHours(23, 59, 59, 999);

    // Count goals created yesterday
    const { rows: goalRows } = await sql`
      SELECT status, COUNT(*)::int as count FROM goals
      WHERE created_at >= ${startOfDay.toISOString()}
        AND created_at <= ${endOfDay.toISOString()}
      GROUP BY status
    `;

    // Count agent actions yesterday
    const { rows: logRows } = await sql`
      SELECT agent_name, COUNT(*)::int as count,
             AVG(duration_ms)::int as avg_duration
      FROM agent_logs
      WHERE timestamp >= ${startOfDay.toISOString()}
        AND timestamp <= ${endOfDay.toISOString()}
      GROUP BY agent_name
      ORDER BY count DESC
    `;

    // Top errors yesterday
    const { rows: errorRows } = await sql`
      SELECT action, COUNT(*)::int as count FROM agent_logs
      WHERE timestamp >= ${startOfDay.toISOString()}
        AND timestamp <= ${endOfDay.toISOString()}
        AND action LIKE '%error%'
      GROUP BY action
      ORDER BY count DESC
      LIMIT 3
    `;

    const totalGoals = goalRows.reduce((sum, r) => sum + (r.count as number), 0);
    const goalMet = goalRows.find((r) => r.status === 'goal_met')?.count || 0;
    const successRate = totalGoals > 0 ? Math.round((goalMet as number / totalGoals) * 100) : 0;

    const agentSummary = logRows
      .slice(0, 5)
      .map((r) => `  ${r.agent_name}: ${r.count} calls, avg ${r.avg_duration}ms`)
      .join('\n');

    const errorSummary = errorRows.length > 0
      ? errorRows.map((r) => `  ${r.action}: ${r.count}`).join('\n')
      : '  None';

    const message =
      `*Daily Build Stats (${yesterday.toISOString().split('T')[0]})*\n\n` +
      `Goals: ${totalGoals} (${successRate}% success)\n` +
      `Agent Activity:\n${agentSummary}\n` +
      `Top Errors:\n${errorSummary}`;

    await notify(message);

    return NextResponse.json({
      date: yesterday.toISOString().split('T')[0],
      totalGoals,
      successRate,
      agentActivity: logRows,
      topErrors: errorRows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
