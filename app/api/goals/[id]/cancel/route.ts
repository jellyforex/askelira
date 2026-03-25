/**
 * Build Cancellation Endpoint — Feature 10 (Steven Gamma)
 *
 * POST /api/goals/[id]/cancel
 * Cancels an active build and sends Telegram notification.
 * Requires authentication + ownership verification.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth-helpers';
import { logger } from '@/lib/logger';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const goalId = params.id;

  try {
    // Phase 5.2: Auth check -- previously missing
    const auth = await authenticate(req);
    if (!auth.authenticated || !auth.customerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify ownership before allowing cancel
    const { getGoal } = await import('@/lib/building-manager');
    const goal = await getGoal(goalId);
    if (goal.customerId !== auth.customerId) {
      return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    }

    const { cancelPipelineRun } = await import('@/lib/pipeline-state');
    const { updateGoalStatus } = await import('@/lib/building-manager');
    const { notify } = await import('@/lib/notify');

    const wasCancelled = cancelPipelineRun(goalId);

    // Update goal status in DB regardless
    await updateGoalStatus(goalId, 'blocked');

    logger.info('Build cancelled', {
      userId: auth.customerId,
      endpoint: `/api/goals/${goalId}/cancel`,
    });

    notify(`Build *cancelled* for goal \`${goalId}\``);

    return NextResponse.json({
      goalId,
      cancelled: true,
      wasPipelineActive: wasCancelled,
      message: wasCancelled
        ? 'Pipeline cancelled. Goal marked as blocked.'
        : 'No active pipeline found. Goal marked as blocked.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Cancel failed', { endpoint: `/api/goals/${goalId}/cancel` }, err instanceof Error ? err : undefined);
    return NextResponse.json({ error: 'Cancel failed' }, { status: 500 });
  }
}
