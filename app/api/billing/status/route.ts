import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  try {
    // Unified auth: support both NextAuth session (web) and header-based auth (CLI)
    const auth = await authenticate(req);
    if (!auth.authenticated || !auth.customerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sql } = await import('@vercel/postgres');

    const { rows } = await sql`
      SELECT
        s.id,
        s.goal_id,
        s.status,
        s.plan_paid,
        s.floors_active,
        s.current_period_end,
        s.grace_period_end,
        g.goal_text,
        g.billing_status
      FROM subscriptions s
      JOIN goals g ON g.id = s.goal_id
      WHERE g.customer_id = ${auth.customerId}
      ORDER BY s.created_at DESC
    `;

    const subscriptions = rows.map((row) => ({
      subscription: {
        id: row.id as string,
        goalId: row.goal_id as string,
        status: row.status as string,
        planPaid: row.plan_paid as boolean,
        floorsActive: (row.floors_active as number) ?? 0,
        currentPeriodEnd: row.current_period_end
          ? (row.current_period_end as string)
          : null,
        gracePeriodEnd: row.grace_period_end
          ? (row.grace_period_end as string)
          : null,
      },
      goal: {
        id: row.goal_id as string,
        goalText: row.goal_text as string,
        billingStatus: (row.billing_status as string) ?? 'unpaid',
      },
    }));

    return NextResponse.json({ subscriptions });
  } catch (err: unknown) {
    console.error('[API /billing/status]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to load billing status' }, { status: 500 });
  }
}
