/**
 * Subscription Manager -- Phase 9 of AskElira 2.1
 *
 * All subscription DB operations + Stripe API calls for billing.
 * Stripe errors NEVER block builds. Dev mode (no STRIPE_SECRET_KEY) always allowed.
 */

import { sql } from '@vercel/postgres';

// ============================================================
// Interface
// ============================================================

export interface Subscription {
  id: string;
  customerId: string;
  goalId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePaymentIntentId: string | null;
  planPaid: boolean;
  status: 'pending' | 'active' | 'past_due' | 'canceled' | 'paused';
  floorsActive: number;
  currentPeriodEnd: Date | null;
  gracePeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Row mapper
// ============================================================

function mapSubscriptionRow(row: Record<string, unknown>): Subscription {
  return {
    id: row.id as string,
    customerId: row.customer_id as string,
    goalId: row.goal_id as string,
    stripeCustomerId: (row.stripe_customer_id as string) ?? null,
    stripeSubscriptionId: (row.stripe_subscription_id as string) ?? null,
    stripePaymentIntentId: (row.stripe_payment_intent_id as string) ?? null,
    planPaid: (row.plan_paid as boolean) ?? false,
    status: (row.status as Subscription['status']) ?? 'pending',
    floorsActive: (row.floors_active as number) ?? 0,
    currentPeriodEnd: row.current_period_end
      ? new Date(row.current_period_end as string)
      : null,
    gracePeriodEnd: row.grace_period_end
      ? new Date(row.grace_period_end as string)
      : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ============================================================
// CRUD operations
// ============================================================

export async function createSubscription(params: {
  customerId: string;
  goalId: string;
}): Promise<Subscription> {
  const { rows } = await sql`
    INSERT INTO subscriptions (customer_id, goal_id)
    VALUES (${params.customerId}, ${params.goalId})
    RETURNING *
  `;
  return mapSubscriptionRow(rows[0]);
}

export async function getSubscription(goalId: string): Promise<Subscription | null> {
  const { rows } = await sql`
    SELECT * FROM subscriptions
    WHERE goal_id = ${goalId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return mapSubscriptionRow(rows[0]);
}

export async function updateSubscriptionStatus(
  goalId: string,
  status: Subscription['status'],
  extras?: {
    currentPeriodEnd?: Date;
    gracePeriodEnd?: Date | null;
  },
): Promise<void> {
  if (extras?.currentPeriodEnd && extras.gracePeriodEnd !== undefined) {
    await sql`
      UPDATE subscriptions
      SET status = ${status},
          current_period_end = ${extras.currentPeriodEnd.toISOString()},
          grace_period_end = ${extras.gracePeriodEnd ? extras.gracePeriodEnd.toISOString() : null},
          updated_at = NOW()
      WHERE goal_id = ${goalId}
    `;
  } else if (extras?.currentPeriodEnd) {
    await sql`
      UPDATE subscriptions
      SET status = ${status},
          current_period_end = ${extras.currentPeriodEnd.toISOString()},
          updated_at = NOW()
      WHERE goal_id = ${goalId}
    `;
  } else if (extras?.gracePeriodEnd !== undefined) {
    await sql`
      UPDATE subscriptions
      SET status = ${status},
          grace_period_end = ${extras.gracePeriodEnd ? extras.gracePeriodEnd.toISOString() : null},
          updated_at = NOW()
      WHERE goal_id = ${goalId}
    `;
  } else {
    await sql`
      UPDATE subscriptions
      SET status = ${status}, updated_at = NOW()
      WHERE goal_id = ${goalId}
    `;
  }
}

export async function activateSubscription(
  goalId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  currentPeriodEnd: Date,
): Promise<void> {
  await sql`
    UPDATE subscriptions
    SET status = 'active',
        stripe_customer_id = ${stripeCustomerId},
        stripe_subscription_id = ${stripeSubscriptionId},
        plan_paid = TRUE,
        current_period_end = ${currentPeriodEnd.toISOString()},
        grace_period_end = NULL,
        updated_at = NOW()
    WHERE goal_id = ${goalId}
  `;
}

export async function addFloorToSubscription(goalId: string): Promise<void> {
  // Increment floors_active in DB
  await sql`
    UPDATE subscriptions
    SET floors_active = floors_active + 1,
        updated_at = NOW()
    WHERE goal_id = ${goalId}
  `;

  // Update Stripe subscription quantity if configured
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log('[Billing] Dev mode — skipping Stripe quantity update');
    return;
  }

  try {
    const { stripe } = await import('./stripe');
    const sub = await getSubscription(goalId);
    if (!sub?.stripeSubscriptionId) return;

    const stripeSub = await stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId,
    );

    // Find the recurring item (floor subscription, not the one-time plan fee)
    const recurringItem = stripeSub.items.data.find(
      (item) => item.price.recurring !== null,
    );

    if (recurringItem) {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items: [
          {
            id: recurringItem.id,
            quantity: sub.floorsActive, // DB was already incremented above
          },
        ],
      });
      console.log(`[Billing] Updated Stripe subscription quantity for goal ${goalId}`);
    }
  } catch (err) {
    console.error('[Billing] Failed to update Stripe subscription quantity:', err);
    // Never let billing failure break the build
  }
}

export async function setGracePeriod(goalId: string): Promise<void> {
  const gracePeriodEnd = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours
  await sql`
    UPDATE subscriptions
    SET grace_period_end = ${gracePeriodEnd.toISOString()},
        updated_at = NOW()
    WHERE goal_id = ${goalId}
  `;
}

export async function isInGracePeriod(goalId: string): Promise<boolean> {
  const sub = await getSubscription(goalId);
  if (!sub || !sub.gracePeriodEnd) return false;
  return new Date() < sub.gracePeriodEnd;
}
