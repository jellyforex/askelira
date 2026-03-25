import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';
import { authenticate } from '@/lib/auth-helpers';
import { validateGoalText } from '@/lib/content-validator';
import { logger } from '@/lib/logger';
import { generateRequestId, handleUnknownError } from '@/lib/api-error';

export async function POST(req: NextRequest) {
  const requestId = generateRequestId();
  const endpoint = 'POST /api/goals/new';

  try {
    // Unified auth: support both NextAuth session (web) and header-based auth (CLI)
    const auth = await authenticate(req);
    if (!auth.authenticated || !auth.customerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit: 10/hour per IP
    const ip = getClientIp(req.headers);
    const rateCheck = checkRateLimit(`goals_new:${ip}`, 10, 3600000);
    if (!rateCheck.allowed) {
      logger.warn('Rate limit exceeded', { requestId, userId: auth.customerId, endpoint });
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        { status: 429 },
      );
    }

    const body = await req.json();
    const { goalText, customerContext } = body;
    // Use authenticated customerId to prevent impersonation
    const customerId = auth.customerId;

    // Validate required fields
    if (!goalText || typeof goalText !== 'string' || goalText.trim().length === 0) {
      return NextResponse.json(
        { error: 'goalText is required and must be a non-empty string' },
        { status: 400 },
      );
    }

    // SD-013: Content validation (replaces simple length check)
    const contentCheck = validateGoalText(goalText);
    if (!contentCheck.valid) {
      return NextResponse.json(
        { error: contentCheck.reason },
        { status: 400 },
      );
    }

    // Try DB, return error if unavailable
    try {
      const { createGoal } = await import('@/lib/building-manager');
      const goal = await createGoal({
        customerId,
        goalText: goalText.trim(),
        customerContext: customerContext ?? {},
      });

      logger.info('Goal created', { requestId, userId: customerId, endpoint });

      return NextResponse.json({
        goalId: goal.id,
        status: goal.status,
        createdAt: goal.createdAt.toISOString(),
      });
    } catch (dbErr: unknown) {
      logger.error('DB error creating goal', { requestId, endpoint }, dbErr instanceof Error ? dbErr : undefined);
      return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 });
    }
  } catch (err: unknown) {
    return handleUnknownError(err, endpoint, requestId);
  }
}
