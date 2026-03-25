import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth-helpers';

// Force dynamic to prevent any response caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
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
      const { getGoal, getRecentLogs, getStevenSuggestions, getPendingExpansions } = await import('@/lib/building-manager');

      const goal = await getGoal(goalId);

      // Verify ownership
      if (goal.customerId !== auth.customerId) {
        return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
      }
      const recentLogs = await getRecentLogs(goalId, 20);

      // Phase 5: Steven's automation suggestions
      let stevenSuggestions: string[] = [];
      try {
        stevenSuggestions = await getStevenSuggestions(goalId);
      } catch {
        // best-effort — suggestions are non-critical
      }

      // Phase 10: Pending expansions
      let pendingExpansions: Array<{
        name: string;
        description: string;
        successCondition: string;
        reasoning: string;
        suggestedAt: string;
      }> = [];
      try {
        const rawExpansions = await getPendingExpansions(goalId);
        pendingExpansions = rawExpansions.map((e) => ({
          ...e,
          suggestedAt: e.suggestedAt.toISOString(),
        }));
      } catch {
        // best-effort — expansions are non-critical
      }

      return NextResponse.json({
        goal: {
          id: goal.id,
          customerId: goal.customerId,
          goalText: goal.goalText,
          customerContext: goal.customerContext,
          buildingSummary: goal.buildingSummary,
          status: goal.status,
          createdAt: goal.createdAt.toISOString(),
          updatedAt: goal.updatedAt.toISOString(),
        },
        floors: goal.floors.map((f) => {
          // Extract fileNames and syntaxValid from buildOutput if available
          let fileNames: string[] | undefined;
          let syntaxValid: boolean | undefined;
          if (f.buildOutput) {
            try {
              const parsed = JSON.parse(f.buildOutput);
              if (Array.isArray(parsed.files)) {
                fileNames = parsed.files.map((file: { name?: string }) => file.name || 'unknown');
              }
              if (typeof parsed.syntaxValid === 'boolean') {
                syntaxValid = parsed.syntaxValid;
              }
            } catch {
              // buildOutput not JSON — leave undefined
            }
          }
          return {
            id: f.id,
            floorNumber: f.floorNumber,
            name: f.name,
            description: f.description,
            successCondition: f.successCondition,
            status: f.status,
            researchOutput: f.researchOutput,
            buildOutput: f.buildOutput,
            vexGate1Report: f.vexGate1Report,
            vexGate2Report: f.vexGate2Report,
            iterationCount: f.iterationCount,
            buildingContext: f.buildingContext,
            handoffNotes: f.handoffNotes,
            createdAt: f.createdAt.toISOString(),
            completedAt: f.completedAt?.toISOString() ?? null,
            fileNames,
            syntaxValid,
          };
        }),
        recentLogs: recentLogs.map((l) => ({
          id: l.id,
          floorId: l.floorId,
          agentName: l.agentName,
          iteration: l.iteration,
          action: l.action,
          inputSummary: l.inputSummary,
          outputSummary: l.outputSummary,
          toolCallsMade: l.toolCallsMade,
          tokensUsed: l.tokensUsed,
          durationMs: l.durationMs,
          timestamp: l.timestamp.toISOString(),
        })),
        stevenSuggestions,
        pendingExpansions,
      });
    } catch (dbErr: unknown) {
      const message = dbErr instanceof Error ? dbErr.message : 'Database error';

      // Distinguish "not found" from other DB errors
      if (message.includes('not found')) {
        return NextResponse.json({ error: message }, { status: 404 });
      }

      console.error('[API /goals/[id]] DB error:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /goals/[id]]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
