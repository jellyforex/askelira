import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ip = getClientIp(req.headers);
    const rateCheck = checkRateLimit(`expand:${ip}`, 5, 3600000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        { status: 429 },
      );
    }

    const goalId = params.id;

    if (!goalId) {
      return NextResponse.json(
        { error: 'Goal ID is required' },
        { status: 400 },
      );
    }

    const body = await req.json();
    const { name, description, successCondition } = body;

    if (!name || !description || !successCondition) {
      return NextResponse.json(
        { error: 'name, description, and successCondition are required' },
        { status: 400 },
      );
    }

    try {
      const {
        getGoal,
        createFloor,
        logAgentAction,
      } = await import('@/lib/building-manager');

      // Load goal
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

      // Goal must be in 'building' or 'goal_met' status
      if (goal.status !== 'building' && goal.status !== 'goal_met') {
        return NextResponse.json(
          { error: `Cannot expand a goal in '${goal.status}' status` },
          { status: 409 },
        );
      }

      // Determine next floor number
      const nextFloorNumber = goal.floors.length > 0
        ? Math.max(...goal.floors.map((f) => f.floorNumber)) + 1
        : 1;

      // Create the new floor
      const floor = await createFloor({
        goalId,
        floorNumber: nextFloorNumber,
        name,
        description,
        successCondition,
      });

      // Log the expansion
      await logAgentAction({
        floorId: floor.id,
        goalId,
        agentName: 'System',
        action: 'floor_expanded',
        outputSummary: `Expansion floor ${nextFloorNumber}: ${name}`,
      });

      // Add to Stripe subscription if configured
      try {
        if (process.env.STRIPE_SECRET_KEY) {
          const { addFloorToSubscription } = await import(
            '@/lib/subscription-manager'
          );
          await addFloorToSubscription(goalId);
        }
      } catch {
        // billing is best-effort
      }

      // Start the floor through step-based building loop
      try {
        const { chainNextStep } = await import('@/lib/step-runner');
        chainNextStep(floor.id, 'alba', 1).catch((err) => {
          console.error(`[API /expand] Step chain failed for ${floor.id}:`, err);
        });
      } catch {
        // step-runner not available
      }

      return NextResponse.json({
        floorId: floor.id,
        floorNumber: nextFloorNumber,
        name,
        description,
        successCondition,
        status: 'pending',
        message: `Expansion floor ${nextFloorNumber} "${name}" created and building loop started.`,
      });
    } catch (dbErr: unknown) {
      const message = dbErr instanceof Error ? dbErr.message : 'Database error';
      console.error('[API /goals/[id]/expand] Error:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /goals/[id]/expand]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
