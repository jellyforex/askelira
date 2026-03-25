import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
  // Stripe webhook signature verification requires raw body
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: 'Missing signature or webhook secret' },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    const { stripe } = await import('@/lib/stripe');
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Signature verification failed';
    logger.error('Webhook signature verification failed', { endpoint: 'POST /api/billing/webhook' }, err instanceof Error ? err : undefined);
    return NextResponse.json(
      { error: 'Webhook signature verification failed' },
      { status: 400 },
    );
  }

  logger.info(`Webhook event: ${event.type}`, { endpoint: 'POST /api/billing/webhook' });

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;

      default:
        logger.info(`Webhook unhandled event: ${event.type}`, { endpoint: 'POST /api/billing/webhook' });
    }
  } catch (err: unknown) {
    logger.error(`Webhook handler error for ${event.type}`, { endpoint: 'POST /api/billing/webhook' }, err instanceof Error ? err : undefined);
    // Still return 200 to prevent Stripe from retrying endlessly
  }

  return NextResponse.json({ received: true });
}

// ============================================================
// Helpers
// ============================================================

/**
 * Extract subscription ID from a Stripe Invoice.
 * In Stripe SDK v20+ the subscription lives under parent.subscription_details.subscription
 */
function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const subDetails = invoice.parent?.subscription_details;
  if (!subDetails) return null;
  const sub = subDetails.subscription;
  if (typeof sub === 'string') return sub;
  if (sub && typeof sub === 'object' && 'id' in sub) return sub.id;
  return null;
}

// ============================================================
// Event handlers
// ============================================================

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const goalId = session.metadata?.goalId;
  const stripeCustomerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id ?? '';
  const stripeSubscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription as Stripe.Subscription | null)?.id ?? '';

  if (!goalId) {
    console.error('[Webhook] checkout.session.completed missing goalId in metadata');
    return;
  }

  console.log(`[Webhook] Checkout completed for goal ${goalId}`);

  const {
    activateSubscription,
    createSubscription,
    getSubscription,
  } = await import('@/lib/subscription-manager');

  // Ensure subscription record exists
  const sub = await getSubscription(goalId);
  if (!sub) {
    await createSubscription({
      customerId: session.metadata?.customerId ?? 'unknown',
      goalId,
    });
  }

  // Activate the subscription
  const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // ~30 days
  await activateSubscription(
    goalId,
    stripeCustomerId,
    stripeSubscriptionId,
    currentPeriodEnd,
  );

  // Update goal billing status
  try {
    const { sql } = await import('@vercel/postgres');
    await sql`UPDATE goals SET billing_status = 'active' WHERE id = ${goalId}`;
  } catch (err) {
    console.error('[Webhook] Failed to update goal billing_status:', err);
  }

  // Trigger the approve + building loop
  try {
    const {
      getGoal,
      updateGoalStatus,
      updateFloorStatus,
      logAgentAction,
    } = await import('@/lib/building-manager');

    const goal = await getGoal(goalId);

    if (goal.status === 'planning') {
      await updateGoalStatus(goalId, 'building');

      const floor1 = goal.floors?.find(
        (f: { floorNumber: number }) => f.floorNumber === 1,
      );
      if (floor1) {
        await updateFloorStatus(floor1.id, 'researching');

        await logAgentAction({
          goalId,
          agentName: 'System',
          action: 'building_approved_via_payment',
          outputSummary: `Payment completed. Building approved. Floor 1 set to researching.`,
        });

        // Start step-based building loop
        try {
          const { chainNextStep } = await import('@/lib/step-runner');
          chainNextStep(floor1.id, 'alba', 1).catch((err: unknown) => {
            console.error(
              `[Webhook] Step chain failed for floor ${floor1.id}:`,
              err,
            );
          });
        } catch {
          // step-runner import failed
        }

        // Start heartbeat after delay
        try {
          const { startHeartbeat } = await import('@/lib/heartbeat');
          setTimeout(() => {
            startHeartbeat(goalId, 5 * 60 * 1000);
          }, 10_000);
        } catch {
          // heartbeat import failed
        }
      }
    }
  } catch (err) {
    console.error('[Webhook] Failed to trigger building loop:', err);
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return;

  console.log(`[Webhook] Payment succeeded for subscription ${subscriptionId}`);

  try {
    const { sql } = await import('@vercel/postgres');

    // Find subscription by stripe_subscription_id
    const { rows } = await sql`
      SELECT goal_id FROM subscriptions
      WHERE stripe_subscription_id = ${subscriptionId}
      LIMIT 1
    `;

    if (rows.length === 0) return;

    const goalId = rows[0].goal_id as string;

    const { updateSubscriptionStatus } = await import(
      '@/lib/subscription-manager'
    );
    await updateSubscriptionStatus(goalId, 'active', {
      gracePeriodEnd: null,
    });

    // Update goal billing status
    await sql`UPDATE goals SET billing_status = 'active' WHERE id = ${goalId}`;

    // Restart heartbeat if it was paused
    try {
      const { startHeartbeat, getHeartbeatStatus } = await import(
        '@/lib/heartbeat'
      );
      const status = getHeartbeatStatus(goalId);
      if (!status.active) {
        startHeartbeat(goalId, 5 * 60 * 1000);
        console.log(`[Webhook] Restarted heartbeat for goal ${goalId}`);
      }
    } catch {
      // heartbeat not available
    }
  } catch (err) {
    console.error('[Webhook] handlePaymentSucceeded error:', err);
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return;

  console.log(`[Webhook] Payment failed for subscription ${subscriptionId}`);

  try {
    const { sql } = await import('@vercel/postgres');

    const { rows } = await sql`
      SELECT goal_id FROM subscriptions
      WHERE stripe_subscription_id = ${subscriptionId}
      LIMIT 1
    `;

    if (rows.length === 0) return;

    const goalId = rows[0].goal_id as string;

    const { setGracePeriod, updateSubscriptionStatus } = await import(
      '@/lib/subscription-manager'
    );
    await updateSubscriptionStatus(goalId, 'past_due');
    await setGracePeriod(goalId);

    // Update goal billing status
    await sql`UPDATE goals SET billing_status = 'past_due' WHERE id = ${goalId}`;
  } catch (err) {
    console.error('[Webhook] handlePaymentFailed error:', err);
  }
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<void> {
  const subscriptionId = subscription.id;
  if (!subscriptionId) return;

  console.log(`[Webhook] Subscription deleted: ${subscriptionId}`);

  try {
    const { sql } = await import('@vercel/postgres');

    const { rows } = await sql`
      SELECT goal_id FROM subscriptions
      WHERE stripe_subscription_id = ${subscriptionId}
      LIMIT 1
    `;

    if (rows.length === 0) return;

    const goalId = rows[0].goal_id as string;

    const { updateSubscriptionStatus } = await import(
      '@/lib/subscription-manager'
    );
    await updateSubscriptionStatus(goalId, 'canceled');

    // Update goal billing status
    await sql`UPDATE goals SET billing_status = 'canceled' WHERE id = ${goalId}`;

    // Stop heartbeat
    try {
      const { stopHeartbeat } = await import('@/lib/heartbeat');
      stopHeartbeat(goalId);
      console.log(`[Webhook] Stopped heartbeat for canceled goal ${goalId}`);
    } catch {
      // heartbeat not available
    }

    // Block all active floors
    try {
      const { getLiveFloors, updateFloorStatus } = await import(
        '@/lib/building-manager'
      );
      const liveFloors = await getLiveFloors(goalId);
      for (const floor of liveFloors) {
        await updateFloorStatus(floor.id, 'blocked');
      }
      console.log(
        `[Webhook] Blocked ${liveFloors.length} floors for canceled goal ${goalId}`,
      );
    } catch {
      // building-manager not available
    }
  } catch (err) {
    console.error('[Webhook] handleSubscriptionDeleted error:', err);
  }
}
