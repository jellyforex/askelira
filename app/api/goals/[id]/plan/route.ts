import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limiter';
import { authenticate } from '@/lib/auth-helpers';

export const maxDuration = 60; // Elira planning calls can take 30-60s

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // Unified auth: support both NextAuth session (web) and header-based auth (CLI)
    const auth = await authenticate(req);
    if (!auth.authenticated || !auth.customerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const goalId = params.id;

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
      const message = dbErr instanceof Error ? dbErr.message : 'Database error';
      console.error('[API /goals/[id]/plan] Error:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /goals/[id]/plan]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
