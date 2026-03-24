import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limiter';
import { safeWaitUntil, getInternalBaseUrl, fetchWithRetry } from '@/lib/internal-fetch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Time budget for running steps (50s of 60s, leaving 10s buffer)
const STEP_BUDGET_MS = 50_000;

export async function POST(
  _req: NextRequest,
  { params }: { params: { floorId: string } },
) {
  try {
    const { floorId } = params;

    if (!floorId) {
      return NextResponse.json(
        { error: 'floorId is required' },
        { status: 400 },
      );
    }

    // Rate limit: 10/hour per floorId (raised from 3 to allow stall recovery restarts)
    const rateCheck = checkRateLimit(`loop_start:${floorId}`, 10, 3600000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        { status: 429 },
      );
    }

    try {
      const { getFloor } = await import('@/lib/building-manager');

      const floor = await getFloor(floorId);

      if (!floor) {
        return NextResponse.json(
          { error: `Floor not found: ${floorId}` },
          { status: 404 },
        );
      }

      // Allow starting/resuming from most statuses
      const allowedStatuses = ['researching', 'pending', 'building', 'auditing'];
      if (!allowedStatuses.includes(floor.status)) {
        return NextResponse.json(
          {
            error: `Floor is in '${floor.status}' status — only pending/researching/building/auditing floors can be started`,
          },
          { status: 409 },
        );
      }

      // Determine which step to start from based on floor state
      let startStep: 'alba' | 'vex1' | 'david' | 'vex2' | 'elira' = 'alba';
      const iteration = floor.iterationCount || 1;

      if (floor.buildOutput && floor.vexGate2Report) {
        startStep = 'elira';
      } else if (floor.buildOutput) {
        startStep = 'vex2';
      } else if (floor.vexGate1Report) {
        try {
          const vex1 = JSON.parse(floor.vexGate1Report);
          if (vex1.approved) {
            startStep = 'david';
          }
        } catch {
          // parse failed, restart from alba
        }
      } else if (floor.researchOutput) {
        startStep = 'vex1';
      }

      // Run steps directly in background with time-estimation
      const buildPromise = (async () => {
        const bgStart = Date.now();
        try {
          const stepRunner = await import('@/lib/step-runner');
          console.log(`[API /loop/start] Running steps from "${startStep}" for floor ${floorId}`);

          let currentFloorId = floorId;
          let currentStep: string = startStep;
          let currentIteration = iteration;
          let allDone = false;

          // Estimated step durations (conservative, in ms)
          const stepDurations: Record<string, number> = {
            alba: 45_000, // Includes OpenResearch, Brave Search, validations
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
              console.log(`[API /loop/start] Not enough time for "${currentStep}" (need ~${estimatedDuration}ms, have ${remaining}ms). Stopping.`);
              break;
            }

            console.log(`[API /loop/start] Running step="${currentStep}" (${remaining}ms remaining, est ${estimatedDuration}ms)`);
            const result = await stepRunner.runStep(
              currentFloorId,
              currentStep as 'alba' | 'vex1' | 'david' | 'vex2' | 'elira' | 'finalize',
              currentIteration,
            );
            console.log(`[API /loop/start] Step "${currentStep}" result: nextStep=${result.nextStep}`);

            if (result.nextStep === 'done') {
              console.log(`[API /loop/start] All steps complete.`);
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

          // If there are remaining steps, fire continuation with retry
          if (!allDone) {
            const baseUrl = getInternalBaseUrl();
            const continueUrl = `${baseUrl}/api/loop/step/${currentFloorId}?step=${currentStep}&iteration=${currentIteration}`;
            console.log(`[API /loop/start] Firing continuation: ${continueUrl}`);
            await fetchWithRetry({ url: continueUrl, tag: 'API /loop/start' });
          }
        } catch (err) {
          console.error(`[API /loop/start] Step runner error:`, err);
        }
      })();

      safeWaitUntil(buildPromise);

      return NextResponse.json({
        started: true,
        floorId,
        floorName: floor.name,
        startStep,
        iteration,
        message: `Step-based loop started for Floor ${floor.floorNumber} "${floor.name}" at step "${startStep}"`,
      });
    } catch (dbErr: unknown) {
      const message = dbErr instanceof Error ? dbErr.message : 'Database error';
      console.error('[API /loop/start] Error:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /loop/start]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
