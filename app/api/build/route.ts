import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTierForEmail } from '@/lib/tiers';
import { sseHeaders } from '@/lib/progress-tracker';
import { waitUntil } from '@vercel/functions';

export const maxDuration = 60;

interface BuildPromptInput {
  question: string;
  decision: string;
  confidence: number;
  argumentsFor: string[];
  research: string | null;
}

async function getUserBuildData(email: string) {
  try {
    const { getUserUsage } = await import('@/lib/db');
    const usage = await getUserUsage(email);
    return usage;
  } catch {
    return { email, plan: 'free' as const, debatesUsed: 0, buildsUsed: 0 };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { question, decision, confidence, argumentsFor, research } =
      body as BuildPromptInput;

    if (!question || !decision) {
      return NextResponse.json(
        { error: 'Question and decision are required' },
        { status: 400 },
      );
    }

    // Auth check (allow anonymous testing with demo account)
    const session = await getServerSession(authOptions);
    const email = session?.user?.email || 'demo@askelira.com';

    // Tier + build limit check
    const usage = await getUserBuildData(email);
    const tier = getTierForEmail(email, usage.plan);
    const buildLimit = tier.unlimited ? Infinity : tier.monthlyDebates;

    const buildsUsed = (usage as { buildsUsed?: number }).buildsUsed ?? 0;

    if (buildLimit !== Infinity && buildsUsed >= buildLimit) {
      return NextResponse.json(
        {
          error: `Build limit reached (${buildsUsed}/${buildLimit}). Upgrade for more builds.`,
          tier: tier.name,
          buildsUsed,
          buildLimit,
        },
        { status: 429 },
      );
    }

    // Create a Goal and Floor for this build, then trigger the building loop
    const { createGoal, createFloor } = await import('@/lib/building-manager');

    const customerId = email; // Use email as customer ID
    const goalText = `Build automation: ${question}`;
    const customerContext = {
      swarmDecision: decision,
      confidence,
      argumentsFor,
      research,
    };

    // Create the goal
    const goal = await createGoal({
      customerId,
      goalText,
      customerContext,
    });

    // Create a floor for this goal
    const floorName = decision === 'yes' ? 'Build the solution' : `Evaluate: ${decision}`;
    const floorDescription = `Based on swarm decision: ${decision} (${confidence}% confidence).\n\nArguments:\n${argumentsFor.map(arg => `- ${arg}`).join('\n')}`;
    const successCondition = `Implement a working solution that addresses: ${question}`;

    const floor = await createFloor({
      goalId: goal.id,
      floorNumber: 1,
      name: floorName,
      description: floorDescription,
      successCondition,
    });

    // SSE streaming response
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Send initial event
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'step',
              step: { id: 1, label: 'Creating automation goal', status: 'done' }
            })}\n\n`),
          );

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'step',
              step: { id: 2, label: 'Starting agent team (Alba → Vex → David → Vex → Elira)', status: 'running' }
            })}\n\n`),
          );

          // Start the building loop in the background
          const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : (process.env.NEXTAUTH_URL || '').trim() || 'http://localhost:3000';

          const loopUrl = `${baseUrl}/api/loop/start/${floor.id}`;

          // Fire the building loop (don't wait for it)
          const buildPromise = (async () => {
            try {
              const res = await fetch(loopUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-cron-secret': process.env.CRON_SECRET || '',
                },
              });

              if (!res.ok) {
                console.error(`[API /build] Loop start failed: ${res.status}`);
              } else {
                console.log(`[API /build] Building loop started for floor ${floor.id}`);
              }
            } catch (err) {
              console.error(`[API /build] Loop start error:`, err);
            }
          })();

          waitUntil(buildPromise);

          // Send completion event with goal/floor info so UI can poll for status
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'step',
              step: {
                id: 2,
                label: 'Agent team started (check /buildings for progress)',
                status: 'done',
                output: `Goal ID: ${goal.id}, Floor ID: ${floor.id}`
              }
            })}\n\n`),
          );

          controller.enqueue(
            encoder.encode(
              `event: done\ndata: ${JSON.stringify({
                type: 'complete',
                goalId: goal.id,
                floorId: floor.id,
                message: 'Building loop started. Your automation is being built by the agent team. Visit /buildings to see progress.',
                files: [
                  {
                    path: 'BUILDING.md',
                    content: `# Building in Progress\n\nYour automation "${question}" is being built by the AskElira agent team.\n\n**Goal ID**: ${goal.id}\n**Floor ID**: ${floor.id}\n\n## Agent Pipeline\n\n1. **Alba** - Research best approaches and libraries\n2. **Vex Gate 1** - Audit research quality\n3. **David** - Build the implementation\n4. **Vex Gate 2** - Audit code quality\n5. **Elira** - Final review and approval\n\nVisit **/buildings** to see real-time progress.\n\n---\n\n**Swarm Decision**: ${decision} (${confidence}% confidence)\n\n**Arguments**:\n${argumentsFor.map(arg => `- ${arg}`).join('\n')}\n\n${research ? `\n**Research**:\n${research}\n` : ''}`,
                  },
                ],
              })}\n\n`,
            ),
          );

        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Build failed';
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, { headers: sseHeaders() });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /build]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
