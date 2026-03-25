import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth-helpers';
import { BUILDING_EVENTS } from '@/lib/events';
import { safeWaitUntil, getInternalBaseUrl, fetchWithRetry } from '@/lib/internal-fetch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Time budget for running steps in background.
// Keep at 55s (leaving 5s for response/overhead).
// The loop checks remaining time before each step and stops if not enough.
const STEP_BUDGET_MS = 55_000;

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

    try {
      const {
        getGoal,
        updateGoalStatus,
        updateFloorStatus,
        logAgentAction,
      } = await import('@/lib/building-manager');
      const { syncToFiles } = await import('@/lib/workspace/workspace-manager');

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
        return NextResponse.json(
          { error: 'You do not own this goal' },
          { status: 403 },
        );
      }

      // Must be in 'planning' status
      if (goal.status !== 'planning') {
        return NextResponse.json(
          {
            error: `Goal is in '${goal.status}' status — only 'planning' goals can be approved`,
          },
          { status: 409 },
        );
      }

      // Must have floors designed
      if (!goal.floors || goal.floors.length === 0) {
        return NextResponse.json(
          { error: 'No floors designed yet — call POST /plan first' },
          { status: 409 },
        );
      }

      // Transition goal to 'building'
      await updateGoalStatus(goalId, 'building');

      // Activate Floor 1 -> researching
      const floor1 = goal.floors.find((f) => f.floorNumber === 1);
      let activatedFloor: { id: string; name: string; floorNumber: number } | null = null;
      if (floor1) {
        await updateFloorStatus(floor1.id, 'researching');
        activatedFloor = {
          id: floor1.id,
          name: floor1.name,
          floorNumber: floor1.floorNumber,
        };
      }

      // Sync to workspace files
      try {
        await syncToFiles(goalId);
      } catch {
        // best-effort
      }

      // Log agent action
      await logAgentAction({
        goalId,
        agentName: 'System',
        action: 'building_approved',
        outputSummary: `Building approved. ${goal.floors.length} floors. Floor 1 set to researching.`,
      });

      // Run steps directly in the background via waitUntil.
      // This runs steps sequentially until time runs out.
      // Remaining steps can be triggered via POST /api/loop/step/{floorId}.
      if (floor1) {
        const buildPromise = (async () => {
          const bgStart = Date.now();
          try {
            const stepRunner = await import('@/lib/step-runner');
            console.log(`[API /approve] Running steps for floor ${floor1.id}`);

            let currentFloorId = floor1.id;
            let currentStep: string = 'alba';
            let currentIteration = 1;
            let allDone = false;

            // Estimated step durations (conservative, in ms)
            const stepDurations: Record<string, number> = {
              alba: 45_000, // Includes OpenResearch, Brave Search, validations, risk analysis
              vex1: 15_000,
              david: 35_000,
              vex2: 15_000,
              elira: 15_000,
              finalize: 10_000,
            };

            while (true) {
              const elapsed = Date.now() - bgStart;
              const remaining = STEP_BUDGET_MS - elapsed;
              const estimatedDuration = stepDurations[currentStep] ?? 20_000;

              // Only start a step if we have enough estimated time for it
              if (remaining < estimatedDuration) {
                console.log(`[API /approve] Not enough time for "${currentStep}" (need ~${estimatedDuration}ms, have ${remaining}ms). Stopping.`);
                break;
              }

              console.log(`[API /approve] Running step="${currentStep}" (${remaining}ms remaining, est ${estimatedDuration}ms)`);
              const result = await stepRunner.runStep(
                currentFloorId,
                currentStep as 'alba' | 'vex1' | 'david' | 'vex2' | 'elira' | 'finalize',
                currentIteration,
              );
              console.log(`[API /approve] Step "${currentStep}" result: nextStep=${result.nextStep}`);

              if (result.nextStep === 'done') {
                console.log(`[API /approve] All steps complete.`);
                allDone = true;
                break;
              }

              if (result.nextStep === 'alba' && result.iteration > 5) {
                await stepRunner.markFloorBlocked(result.floorId);
                allDone = true;
                break;
              }

              currentStep = result.nextStep;
              currentFloorId = result.floorId;
              currentIteration = result.iteration;
            }

            // If there are remaining steps, trigger continuation via HTTP.
            // We await the fetch with a short timeout — just long enough for the
            // request to reach Vercel's edge and spawn a new function invocation.
            // We don't need to wait for the full response (which would block until
            // the next step finishes).
            if (!allDone) {
              const baseUrl = getInternalBaseUrl();
              const continueUrl = `${baseUrl}/api/loop/step/${currentFloorId}?step=${currentStep}&iteration=${currentIteration}`;
              console.log(`[API /approve] Firing continuation: ${continueUrl}`);
              await fetchWithRetry({ url: continueUrl, tag: 'API /approve' });
            }
          } catch (err) {
            console.error(`[API /approve] Step runner error:`, err);
          }
        })();

        safeWaitUntil(buildPromise);
      }

      console.log(`[EVENT] ${BUILDING_EVENTS.APPROVED}`, JSON.stringify({ goalId }));

      return NextResponse.json({
        goalId,
        status: 'building',
        activatedFloor,
        message: `Building approved. Floor 1 "${floor1?.name ?? 'unknown'}" is now researching.`,
      });
    } catch (dbErr: unknown) {
      const message = dbErr instanceof Error ? dbErr.message : 'Database error';
      console.error('[API /goals/[id]/approve] Error:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /goals/[id]/approve]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
