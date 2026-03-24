// @ts-nocheck
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import type { Goal, Floor } from '@/lib/building-manager';

export interface WorkspaceFiles {
  soul: string;
  agents: string;
  tools: string;
}

export function getWorkspacePath(): string {
  return path.join(os.homedir(), 'askelira');
}

export async function readSoul(): Promise<string> {
  const p = path.join(getWorkspacePath(), 'SOUL.md');
  if (!existsSync(p)) return DEFAULT_SOUL;
  return fs.readFile(p, 'utf-8');
}

export async function readAgents(): Promise<string> {
  const p = path.join(getWorkspacePath(), 'AGENTS.md');
  if (!existsSync(p)) return DEFAULT_AGENTS;
  return fs.readFile(p, 'utf-8');
}

export async function readTools(): Promise<string> {
  const p = path.join(getWorkspacePath(), 'TOOLS.md');
  if (!existsSync(p)) return DEFAULT_TOOLS;
  return fs.readFile(p, 'utf-8');
}

export async function writeAgents(content: string): Promise<void> {
  const p = path.join(getWorkspacePath(), 'AGENTS.md');
  await fs.writeFile(p, content, 'utf-8');
}

export async function readAllWorkspace(): Promise<WorkspaceFiles> {
  const [soul, agents, tools] = await Promise.all([
    readSoul(), readAgents(), readTools(),
  ]);
  return { soul, agents, tools };
}

export async function writeSoul(content: string): Promise<void> {
  const p = path.join(getWorkspacePath(), 'SOUL.md');
  await fs.writeFile(p, content, 'utf-8');
}

/**
 * Sync building state from Postgres to workspace files.
 * Reads the goal + floors from DB and writes a human-readable
 * summary to SOUL.md and AGENTS.md, preserving existing content.
 */
export async function syncToFiles(goalId: string): Promise<void> {
  // Dynamic import to avoid circular deps and allow fallback when DB is unavailable
  const { getGoal } = await import('@/lib/building-manager');

  let goal: Goal & { floors: Floor[] };
  try {
    goal = await getGoal(goalId);
  } catch {
    // DB unavailable or goal not found — skip sync silently
    return;
  }

  // --- Update SOUL.md: append building state summary ---
  const soulContent = await readSoul();

  const statusEmoji: Record<string, string> = {
    planning: '[PLANNING]',
    building: '[BUILDING]',
    goal_met: '[COMPLETE]',
    blocked: '[BLOCKED]',
  };

  const floorStatusEmoji: Record<string, string> = {
    pending: '[ ]',
    researching: '[R]',
    building: '[B]',
    auditing: '[A]',
    live: '[*]',
    broken: '[!]',
    blocked: '[X]',
  };

  const summaryLine = goal.buildingSummary
    ? `**Building Summary:** ${goal.buildingSummary}`
    : '';

  const floorLines: string[] = [];
  for (const f of goal.floors) {
    const statusTag = floorStatusEmoji[f.status] ?? '[ ]';
    const iterTag = f.iterationCount > 0 ? ` (iteration ${f.iterationCount})` : '';
    floorLines.push(
      `${statusTag} **Floor ${f.floorNumber}: ${f.name}** - ${f.status}${iterTag}`,
    );
    if (f.description) {
      floorLines.push(`    ${f.description}`);
    }
    if (f.successCondition) {
      floorLines.push(`    Success: ${f.successCondition}`);
    }
  }

  const buildingSummary = [
    '',
    '## Active Building',
    '',
    `**Goal:** ${goal.goalText}`,
    `**Status:** ${statusEmoji[goal.status] ?? goal.status} ${goal.status}`,
    `**Customer:** ${goal.customerId}`,
    ...(summaryLine ? [summaryLine] : []),
    '',
    '### Floors',
    '',
    ...floorLines,
    '',
  ].join('\n');

  // Replace any existing "## Active Building" section or append
  const buildingSection = /\n## Active Building[\s\S]*$/;
  const updatedSoul = buildingSection.test(soulContent)
    ? soulContent.replace(buildingSection, buildingSummary)
    : soulContent.trimEnd() + '\n' + buildingSummary;

  await writeSoul(updatedSoul);

  // --- Update AGENTS.md: append building state ---
  const agentsContent = await readAgents();

  const agentFloorLines: string[] = [];
  for (const f of goal.floors) {
    const handoff = f.handoffNotes ? ` | ${f.handoffNotes}` : '';
    agentFloorLines.push(
      `- Floor ${f.floorNumber} (${f.name}): ${f.status}${handoff}`,
    );
    if (f.description) {
      agentFloorLines.push(`  ${f.description}`);
    }
    if (f.successCondition) {
      agentFloorLines.push(`  Success: ${f.successCondition}`);
    }
  }

  const buildingState = [
    '',
    '## Building State',
    '',
    `Goal: ${goal.goalText} (${goal.status})`,
    ...(goal.buildingSummary ? [`Summary: ${goal.buildingSummary}`] : []),
    '',
    ...agentFloorLines,
    '',
  ].join('\n');

  // Replace any existing "## Building State" section or append before Results
  const buildingStateSection = /\n## Building State[\s\S]*?(?=\n## Results|$)/;
  const resultsSection = /\n## Results/;

  let updatedAgents: string;
  if (buildingStateSection.test(agentsContent)) {
    // Replace existing building state section
    if (resultsSection.test(agentsContent)) {
      updatedAgents = agentsContent.replace(
        buildingStateSection,
        buildingState + '\n',
      );
    } else {
      updatedAgents = agentsContent.replace(buildingStateSection, buildingState);
    }
  } else if (resultsSection.test(agentsContent)) {
    // Insert before Results section
    updatedAgents = agentsContent.replace(
      /\n## Results/,
      buildingState + '\n## Results',
    );
  } else {
    // Append at end
    updatedAgents = agentsContent.trimEnd() + '\n' + buildingState;
  }

  await writeAgents(updatedAgents);
}

export const DEFAULT_SOUL = `# SOUL.md - Your AI Assistant

## Who I Am
I am your automation assistant. I turn your goals into working code.

## My Values
- Ship fast, iterate faster
- Cost-conscious by default
- Security first (API keys never in code)
- Real solutions only

## How I Work
1. Alba researches your request
2. David debates the best approach (10k agents)
3. Vex audits the decision
4. Elira synthesizes the plan
5. Builder generates working code

## Boundaries
I ask first before spending over $5 or deploying to production.
`;

export const DEFAULT_AGENTS = `# AGENTS.md - Your Workspace

## Active Agents
- **Alba** - Research
- **David** - Debate Orchestrator (10k agents)
- **Vex** - Quality Auditor
- **Elira** - Synthesis
- **Builder** - Code Generation

## Current Task
[Describe your automation goal here]

## Context
[Paste any relevant info]

## Results
[Results will appear here]
`;

export const DEFAULT_TOOLS = `# TOOLS.md - Tools & API Keys

## API Keys
ANTHROPIC_API_KEY=
BRAVE_API_KEY=

## Available Tools
- Brave Search
- OpenClaw Browser
- Code Generation
- File System (sandboxed to ~/askelira/builds/)
`;
