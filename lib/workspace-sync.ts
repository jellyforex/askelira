/**
 * Workspace Sync — Phase 3 (CLI Phase 3)
 *
 * Writes build outputs to customer workspace directories.
 * All functions are fire-and-forget: they NEVER throw.
 */

import path from 'path';
import fs from 'fs/promises';
import { ensureWorkspace, getWorkspacePath } from './workspace-paths';
import { normalizeDavidResult } from './shared-types';

/**
 * Sanitize a file name from LLM output to prevent path traversal.
 * Strips directory separators and '..' components, then validates
 * the resolved path stays inside the parent directory.
 */
function sanitizeFileName(name: string, parentDir: string): string | null {
  // Remove null bytes and leading/trailing whitespace
  const cleaned = name.replace(/\0/g, '').trim();
  if (!cleaned) return null;

  // Resolve the full path and verify it stays inside parentDir
  const resolved = path.resolve(parentDir, cleaned);
  const normalizedParent = path.resolve(parentDir) + path.sep;

  if (!resolved.startsWith(normalizedParent) && resolved !== path.resolve(parentDir)) {
    console.warn(`[WorkspaceSync] Blocked path traversal attempt: "${name}"`);
    return null;
  }

  return resolved;
}

// ============================================================
// Floor output writer
// ============================================================

/**
 * Write the output of a completed floor to the customer workspace.
 *
 * Creates:
 *   workspace/floors/floor-N-<name>/output.md
 *   workspace/floors/floor-N-<name>/handoff.md
 *   workspace/automations/<name>.md (if buildOutput exists)
 *
 * Never throws — all errors are swallowed and logged.
 */
export async function writeFloorOutput(
  customerId: string,
  floorNumber: number,
  floorName: string,
  buildOutput: string | null,
  handoffNotes: string | null,
): Promise<void> {
  try {
    await ensureWorkspace(customerId);
    const workspace = getWorkspacePath(customerId);

    // Sanitize floor name for filesystem
    const safeName = floorName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);

    const floorDir = path.join(workspace, 'floors', `floor-${floorNumber}-${safeName}`);
    await fs.mkdir(floorDir, { recursive: true });

    // Write build output — try to extract individual code files
    if (buildOutput) {
      let wroteFiles = false;
      try {
        const parsed = JSON.parse(buildOutput);
        const normalized = normalizeDavidResult(parsed);
        if (normalized.files.length > 0) {
          // Write each code file individually
          for (const file of normalized.files) {
            const safePath = sanitizeFileName(file.name, floorDir);
            if (!safePath) continue; // skip files with traversal attempts
            await fs.mkdir(path.dirname(safePath), { recursive: true });
            await fs.writeFile(safePath, file.content, 'utf-8');
          }
          // Write summary output.md
          const summaryContent = [
            `# Floor ${floorNumber}: ${floorName}`,
            '',
            `**Status:** LIVE`,
            `**Built:** ${new Date().toISOString()}`,
            `**Entry Point:** ${normalized.entryPoint}`,
            `**Language:** ${normalized.language}`,
            `**Syntax Valid:** ${normalized.syntaxValid === true ? 'Yes' : normalized.syntaxValid === false ? 'No' : 'Unchecked'}`,
            '',
            '## Files',
            '',
            ...normalized.files.map((f) => `- \`${f.name}\``),
            '',
            normalized.handoffNotes ? `## Handoff Notes\n\n${normalized.handoffNotes}\n` : '',
          ].join('\n');
          await fs.writeFile(path.join(floorDir, 'output.md'), summaryContent, 'utf-8');
          wroteFiles = true;
        }
      } catch {
        // Parse failed — fall through to raw write
      }

      if (!wroteFiles) {
        const outputPath = path.join(floorDir, 'output.md');
        const outputContent = [
          `# Floor ${floorNumber}: ${floorName}`,
          '',
          `**Status:** LIVE`,
          `**Built:** ${new Date().toISOString()}`,
          '',
          '## Build Output',
          '',
          buildOutput,
          '',
        ].join('\n');
        await fs.writeFile(outputPath, outputContent, 'utf-8');
      }
    }

    // Write handoff notes
    if (handoffNotes) {
      const handoffPath = path.join(floorDir, 'handoff.md');
      const handoffContent = [
        `# Handoff Notes - Floor ${floorNumber}: ${floorName}`,
        '',
        handoffNotes,
        '',
      ].join('\n');
      await fs.writeFile(handoffPath, handoffContent, 'utf-8');
    }

    // Write to automations directory
    if (buildOutput) {
      const automationsDir = path.join(workspace, 'automations');
      await fs.mkdir(automationsDir, { recursive: true });

      // Try to write individual code files into automations subdirectory
      let wroteAutomationFiles = false;
      try {
        const parsed = JSON.parse(buildOutput);
        const normalized = normalizeDavidResult(parsed);
        if (normalized.files.length > 0) {
          const automationSubDir = path.join(automationsDir, safeName);
          await fs.mkdir(automationSubDir, { recursive: true });
          for (const file of normalized.files) {
            const safePath = sanitizeFileName(file.name, automationSubDir);
            if (!safePath) continue; // skip files with traversal attempts
            await fs.mkdir(path.dirname(safePath), { recursive: true });
            await fs.writeFile(safePath, file.content, 'utf-8');
          }
          wroteAutomationFiles = true;
        }
      } catch {
        // fall through to legacy write
      }

      if (!wroteAutomationFiles) {
        const automationPath = path.join(automationsDir, `${safeName}.md`);
        const automationContent = [
          `# ${floorName}`,
          '',
          `Floor ${floorNumber} -- Completed ${new Date().toISOString()}`,
          '',
          buildOutput,
          '',
          handoffNotes ? `## Handoff Notes\n\n${handoffNotes}\n` : '',
        ].join('\n');
        await fs.writeFile(automationPath, automationContent, 'utf-8');
      }
    }

    console.log(`[WorkspaceSync] Wrote floor ${floorNumber} output for customer ${customerId}`);
  } catch (err) {
    console.error('[WorkspaceSync] writeFloorOutput failed:', err);
    // Never throw
  }
}

// ============================================================
// SOUL.md writer
// ============================================================

interface FloorInfo {
  floorNumber: number;
  name: string;
  status: string;
  description?: string | null;
  successCondition?: string;
}

/**
 * Update the SOUL.md file in a customer workspace with goal and floor info.
 * Never throws.
 */
export async function writeSoulMd(
  customerId: string,
  goalText: string,
  floors: FloorInfo[],
): Promise<void> {
  try {
    await ensureWorkspace(customerId);
    const workspace = getWorkspacePath(customerId);
    const soulPath = path.join(workspace, 'SOUL.md');

    const statusMap: Record<string, string> = {
      pending: '[ ]',
      researching: '[R]',
      building: '[B]',
      auditing: '[A]',
      live: '[*]',
      broken: '[!]',
      blocked: '[X]',
    };

    const floorLines = floors.map((f) => {
      const tag = statusMap[f.status] ?? '[ ]';
      const desc = f.description ? ` -- ${f.description}` : '';
      return `${tag} Floor ${f.floorNumber}: ${f.name}${desc}`;
    });

    const content = [
      '# SOUL.md -- Customer Workspace',
      '',
      `**Goal:** ${goalText}`,
      `**Updated:** ${new Date().toISOString()}`,
      '',
      '## Floors',
      '',
      ...floorLines,
      '',
      '## Structure',
      '- `floors/` -- Build outputs for each floor',
      '- `automations/` -- Completed automation files',
      '- `SOUL.md` -- This file (workspace overview)',
      '',
    ].join('\n');

    await fs.writeFile(soulPath, content, 'utf-8');
    console.log(`[WorkspaceSync] Updated SOUL.md for customer ${customerId}`);
  } catch (err) {
    console.error('[WorkspaceSync] writeSoulMd failed:', err);
    // Never throw
  }
}
