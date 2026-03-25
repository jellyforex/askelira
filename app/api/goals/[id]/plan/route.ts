import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limiter';
import { authenticate } from '@/lib/auth-helpers';
import { logger } from '@/lib/logger';

export const maxDuration = 60; // Elira planning calls can take 30-60s

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const startTime = Date.now();
  const goalId = params.id;

  try {
    logger.info('Plan request received', { goalId });

    // Unified auth: support both NextAuth session (web) and header-based auth (CLI)
    const auth = await authenticate(req);
    if (!auth.authenticated || !auth.customerId) {
      logger.warn('Unauthorized plan request', { goalId });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!goalId) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 },
      );
    }

    // Rate limit: 5/hour per goalId
    const rateCheck = checkRateLimit(`goals_plan:${goalId}`, 5, 3600000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        { status: 429 },
      );
    }

    try {
      const { getGoal } = await import('@/lib/building-manager');
      const { designBuilding } = await import('@/lib/floor-zero');

      // Load goal from DB
      let goal;
      try {
        goal = await getGoal(goalId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (message.includes('not found')) {
          return NextResponse.json({ error: message }, { status: 404 });
        }
        throw err;
      }

      // Verify ownership
      if (goal.customerId !== auth.customerId) {
        return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
      }

      // Must be in 'planning' status
      if (goal.status !== 'planning') {
        return NextResponse.json(
          {
            error: `Goal is in '${goal.status}' status — only 'planning' goals can be planned`,
          },
          { status: 409 },
        );
      }

      // Idempotent: if floors already exist, return existing plan
      if (goal.floors && goal.floors.length > 0) {
        logger.info('Returning cached plan', { goalId: goal.id, floorCount: goal.floors.length });
        return NextResponse.json({
          goalId: goal.id,
          buildingSummary: goal.buildingSummary ?? 'Plan already exists',
          floorCount: goal.floors.length,
          totalEstimatedHours: 0,
          floors: goal.floors.map((f) => ({
            number: f.floorNumber,
            name: f.name,
            description: f.description,
            successCondition: f.successCondition,
            status: f.status,
          })),
          cached: true,
        });
      }

      // Phase 10: Check templates before calling designBuilding
      try {
        const { detectCategory } = await import('@/lib/pattern-manager');
        const category = detectCategory(goal.goalText, '', '');
        if (category) {
          const { getBestTemplate, incrementTemplateUseCount, createFloor, updateGoalSummary } = await import('@/lib/building-manager');
          const template = await getBestTemplate(category);
          if (template && template.floorBlueprints.length > 0) {
            // Use template instead of calling Elira
            for (const bp of template.floorBlueprints) {
              await createFloor({
                goalId: goal.id,
                floorNumber: bp.floorNumber,
                name: bp.name,
                description: bp.description,
                successCondition: bp.successCondition,
              });
            }
            await updateGoalSummary(goal.id, template.buildingSummary);
            await incrementTemplateUseCount(template.id);

            const duration = Date.now() - startTime;
            logger.info('Plan generated from template', {
              goalId: goal.id,
              templateId: template.id,
              floorCount: template.floorBlueprints.length,
              duration,
            });

            return NextResponse.json({
              goalId: goal.id,
              buildingSummary: template.buildingSummary,
              floorCount: template.floorBlueprints.length,
              totalEstimatedHours: template.avgCompletionHours ?? 0,
              floors: template.floorBlueprints.map((f) => ({
                number: f.floorNumber,
                name: f.name,
                description: f.description,
                successCondition: f.successCondition,
              })),
              templateId: template.id,
            });
          }
        }
      } catch {
        // Template lookup failed -- fall through to designBuilding
      }

      // Design the building (no template match)
      const contextStr = goal.customerContext
        ? JSON.stringify(goal.customerContext)
        : undefined;

      const result = await designBuilding(goal.id, goal.goalText, contextStr);

      const duration = Date.now() - startTime;
      logger.info('Plan generated successfully', {
        goalId: goal.id,
        floorCount: result.floorCount,
        duration,
      });

      return NextResponse.json({
        goalId: goal.id,
        buildingSummary: result.buildingSummary,
        floorCount: result.floorCount,
        totalEstimatedHours: result.totalEstimatedHours,
        floors: result.floors.map((f) => ({
          number: f.number,
          name: f.name,
          description: f.description,
          successCondition: f.successCondition,
          complexity: f.complexity,
          estimatedHours: f.estimatedHours,
        })),
      });
    } catch (dbErr: unknown) {
      const duration = Date.now() - startTime;
      const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);

      logger.error('Plan generation failed', {
        goalId,
        duration,
        errorType: dbErr instanceof Error ? dbErr.name : 'Unknown',
      }, dbErr instanceof Error ? dbErr : undefined);

      // Provide user-friendly error messages based on error type
      let userMessage = 'Failed to plan goal';
      if (errMsg.includes('ANTHROPIC_API_KEY')) {
        userMessage = 'AI service not configured. Please contact support.';
      } else if (errMsg.includes('Anthropic API error')) {
        userMessage = 'AI service unavailable. Please try again in a moment.';
      } else if (errMsg.includes('database') || errMsg.includes('postgres')) {
        userMessage = 'Database error. Please try again or contact support.';
      } else if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
        userMessage = 'Request timed out. Please try again.';
      } else if (errMsg.includes('network') || errMsg.includes('ECONNREFUSED')) {
        userMessage = 'Network error. Please check your connection and try again.';
      } else if (errMsg.includes('rate limit')) {
        userMessage = 'Too many requests. Please wait a moment and try again.';
      }

      return NextResponse.json({
        error: userMessage,
        details: process.env.NODE_ENV === 'development' ? errMsg : undefined
      }, { status: 500 });
    }
  } catch (err: unknown) {
    const duration = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);

    logger.error('Plan request failed (outer catch)', {
      goalId,
      duration,
      errorType: err instanceof Error ? err.name : 'Unknown',
    }, err instanceof Error ? err : undefined);

    return NextResponse.json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? errMsg : undefined
    }, { status: 500 });
  }
}
