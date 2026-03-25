// ============================================================
// AskElira CLI — build command
// ============================================================
// Interactive onboarding wizard for creating a new goal.

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as api from '../lib/api';
import {
  statusBadge,
  truncate,
  boxTop,
  boxBottom,
  boxRow,
  boxDivider,
} from '../lib/format';
import { runPhaseZero, quickValidation } from '../lib/phase-zero';
import { getApiKey, getEmail, getLLMApiKey, getGatewayUrl, getGatewayToken, getGatewayMode } from '../lib/auth';
import { testGatewayConnection } from './gateway';

/**
 * Feature 45: Run a single agent in isolation with user-provided prompt.
 */
async function runSingleAgent(agentName: string, prompt: string): Promise<void> {
  console.log('');
  console.log(chalk.bold(`  Running agent: ${agentName}`));
  console.log(chalk.gray(`  Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`));
  console.log('');

  const llmApiKey = getLLMApiKey();
  if (!llmApiKey) {
    console.log(chalk.red('  Anthropic API key not configured. Run `askelira init`.'));
    process.exitCode = 1;
    return;
  }

  const spinner = ora(`Calling ${agentName}...`).start();

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: llmApiKey });

    const { ALBA_RESEARCH_PROMPT, DAVID_BUILD_PROMPT, VEX_GATE1_PROMPT, VEX_GATE2_PROMPT, ELIRA_FLOOR_REVIEW_PROMPT } = await import('../../lib/agent-prompts');

    const prompts: Record<string, string> = {
      alba: ALBA_RESEARCH_PROMPT,
      david: DAVID_BUILD_PROMPT,
      vex1: VEX_GATE1_PROMPT,
      vex2: VEX_GATE2_PROMPT,
      elira: ELIRA_FLOOR_REVIEW_PROMPT,
    };

    const systemPrompt = prompts[agentName.toLowerCase()] || `You are ${agentName}, an AI agent. Respond helpfully.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    spinner.stop();
    const text = response.content[0].type === 'text' ? response.content[0].text : '(no text response)';
    console.log(chalk.green(`  ${agentName} response:\n`));
    console.log(text);
    console.log('');
  } catch (err: unknown) {
    spinner.fail(chalk.red(`${agentName} call failed`));
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.log(chalk.red(`  ${msg}`));
    process.exitCode = 1;
  }
}

/**
 * Main build command handler.
 * Accepts optional goal text as positional arg.
 * Feature 44: --dry-run runs only Floor 0 design, then exits.
 * Feature 45: --agent runs a single agent in isolation.
 */
export async function buildCommand(goalText?: string, options?: { dryRun?: boolean; agent?: string }): Promise<void> {
  // Feature 45: Single agent mode
  if (options?.agent) {
    const prompt = goalText || 'Hello, what can you do?';
    await runSingleAgent(options.agent, prompt);
    return;
  }
  // Gateway reachability check
  const gwMode = getGatewayMode();
  if (gwMode === 'gateway' || gwMode === 'gateway-only') {
    const gwUrl = getGatewayUrl();
    const gwToken = getGatewayToken();
    if (gwUrl) {
      try {
        const gwResult = await testGatewayConnection(gwUrl, gwToken);
        if (gwResult.connected) {
          console.log(chalk.green(`  Gateway connected (${gwResult.latencyMs}ms, session: ${gwResult.sessionId || 'n/a'})`));
        } else if (gwMode === 'gateway-only') {
          console.log(chalk.red(`  Gateway not connected. Run: openclaw gateway start`));
          console.log(chalk.red(`  Error: ${gwResult.error || 'unreachable'}`));
          process.exitCode = 1;
          return;
        } else {
          console.log(chalk.yellow(`  Gateway unreachable — will use direct API`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (gwMode === 'gateway-only') {
          console.log(chalk.red(`  Gateway not connected. Run: openclaw gateway start`));
          console.log(chalk.red(`  Error: ${msg}`));
          process.exitCode = 1;
          return;
        }
        console.log(chalk.yellow(`  Gateway check failed — will use direct API`));
      }
    } else if (gwMode === 'gateway-only') {
      console.log(chalk.red(`  Gateway not connected. No OPENCLAW_GATEWAY_URL configured.`));
      process.exitCode = 1;
      return;
    }
  }

  console.log('');
  console.log(chalk.bold('  AskElira Build Wizard'));
  console.log(chalk.gray('  Create a new automation from scratch'));
  console.log('');

  // ── Step 1: Goal input ───────────────────────────────────
  let finalGoalText = goalText || '';

  if (!finalGoalText) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'goalText',
        message: 'What do you want to build?',
        validate: (input: string) => {
          if (!input || input.trim().length < 20) {
            return 'Goal must be at least 20 characters. Be specific about what you want.';
          }
          return true;
        },
      },
    ]);
    finalGoalText = answers.goalText.trim();
  } else {
    // Validate provided goal text
    if (finalGoalText.trim().length < 20) {
      console.log(
        chalk.red('  Goal must be at least 20 characters. Be specific about what you want.'),
      );
      process.exitCode = 1;
      return;
    }
    console.log(`  ${chalk.gray('Goal:')} ${finalGoalText}`);
  }

  // ── Step 2: Phase 0 Business Plan ────────────────────────
  console.log('');

  // Quick validation check
  const warnings = quickValidation(finalGoalText);
  if (warnings.length > 0) {
    console.log(chalk.yellow('Quick checks found potential issues:\n'));
    warnings.forEach(w => console.log(`  ${w}`));
    console.log();
  }

  // Get Anthropic LLM API key (distinct from AskElira platform key)
  const llmApiKey = getLLMApiKey();
  if (!llmApiKey || llmApiKey.length === 0) {
    console.log(chalk.red('  ✗ Anthropic API key not configured'));
    console.log(chalk.gray('  Phase 0 requires your Anthropic API key (llm.apiKey in config).'));
    console.log(chalk.gray('  Run `askelira init` to configure your API key.'));
    console.log('');
    process.exitCode = 1;
    return;
  }

  // Get user email for Personal Context
  const userEmail = getEmail();

  // Run Phase 0 conversation with Personal Context
  let phaseZeroResult;
  try {
    phaseZeroResult = await runPhaseZero(finalGoalText, llmApiKey, userEmail);
  } catch (err: unknown) {
    console.log(chalk.red('\n✗ Phase 0 conversation failed'));
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(chalk.red(`  ${message}`));
    console.log('');
    process.exitCode = 1;
    return;
  }

  // Check if Phase 0 returned a valid result
  if (!phaseZeroResult) {
    console.log(chalk.red('\n✗ Phase 0 returned no result'));
    console.log('');
    process.exitCode = 1;
    return;
  }

  // Check if approved
  if (!phaseZeroResult.approved) {
    console.log(chalk.yellow('\n✗ Goal not approved for building'));
    console.log(chalk.gray(`  ${phaseZeroResult.conversationSummary}`));
    console.log('');
    console.log(chalk.gray('  Refine your goal and try again with: askelira build'));
    console.log('');
    process.exitCode = 1;
    return;
  }

  // Validate that we have a refined goal before proceeding
  if (!phaseZeroResult.refinedGoal || phaseZeroResult.refinedGoal.trim().length === 0) {
    console.log(chalk.red('\n✗ Phase 0 approved but no refined goal was produced'));
    console.log(chalk.gray('  This is unexpected. Try again with: askelira build'));
    console.log('');
    process.exitCode = 1;
    return;
  }

  // Use refined goal from Phase 0
  finalGoalText = phaseZeroResult.refinedGoal;

  console.log(chalk.green('\n✓ Phase 0 complete! Proceeding to Floor Zero (Elira)...\n'));

  // ── Step 3: Optional business context ────────────────────
  const contextAnswers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addContext',
      message: 'Add business context? (industry, tools, etc.)',
      default: false,
    },
  ]);

  let customerContext: Record<string, string> = {};

  if (contextAnswers.addContext) {
    const ctxDetails = await inquirer.prompt([
      {
        type: 'input',
        name: 'industry',
        message: 'Industry:',
        default: '',
      },
      {
        type: 'input',
        name: 'tools',
        message: 'Tools/platforms you use:',
        default: '',
      },
      {
        type: 'input',
        name: 'notes',
        message: 'Any other context:',
        default: '',
      },
    ]);

    if (ctxDetails.industry) customerContext.industry = ctxDetails.industry;
    if (ctxDetails.tools) customerContext.tools = ctxDetails.tools;
    if (ctxDetails.notes) customerContext.notes = ctxDetails.notes;
  }

  // ── Step 4: Create goal via API ──────────────────────────
  const createSpinner = ora('Creating goal...').start();

  let goalId: string;
  try {
    const createRes = await api.createGoal({
      goalText: finalGoalText,
      customerContext: Object.keys(customerContext).length > 0 ? customerContext : undefined,
    });

    if (!createRes.ok) {
      createSpinner.fail(chalk.red('Failed to create goal'));
      const errData = createRes.data as unknown as { error?: string };
      console.log(chalk.red(`  ${errData?.error || `HTTP ${createRes.status}`}`));
      process.exitCode = 1;
      return;
    }

    goalId = createRes.data.goalId;
    createSpinner.succeed(chalk.green(`Goal created: ${chalk.cyan(goalId)}`));
  } catch (err: unknown) {
    createSpinner.fail(chalk.red('Connection error'));
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(chalk.red(`  ${message}`));
    process.exitCode = 1;
    return;
  }

  // ── Step 5: Elira designs the building ───────────────────
  const planSpinner = ora('Elira is designing your building...').start();

  let planResult: api.PlanResult;
  try {
    const planRes = await api.getPlan(goalId);

    if (!planRes.ok) {
      planSpinner.fail(chalk.red('Design failed'));
      const errData = planRes.data as unknown as { error?: string };
      console.log(chalk.red(`  ${errData?.error || `HTTP ${planRes.status}`}`));
      console.log(chalk.gray(`  Goal was created (${goalId}) but design failed. Try again with: askelira status ${goalId}`));
      process.exitCode = 1;
      return;
    }

    planResult = planRes.data;
    planSpinner.succeed(chalk.green(`Blueprint ready: ${planResult.floorCount} floors designed`));
  } catch (err: unknown) {
    planSpinner.fail(chalk.red('Connection error during design'));
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(chalk.red(`  ${message}`));
    console.log(chalk.gray(`  Goal was created (${goalId}). Retry design with: askelira status ${goalId}`));
    process.exitCode = 1;
    return;
  }

  // ── Step 6: Print floor plan ─────────────────────────────
  console.log('');
  const width = 60;

  console.log(boxTop('Building Blueprint', width));

  if (planResult.buildingSummary) {
    const summaryLines = wrapText(planResult.buildingSummary, width - 6);
    for (const line of summaryLines) {
      console.log(boxRow(chalk.gray(line), width));
    }
    console.log(boxDivider(width));
  }

  for (const floor of planResult.floors) {
    console.log(
      boxRow(
        `  ${chalk.bold(`Floor ${floor.number}:`)} ${chalk.white(floor.name)}`,
        width,
      ),
    );
    if (floor.description) {
      console.log(boxRow(`    ${chalk.gray(truncate(floor.description, width - 12))}`, width));
    }
    if (floor.successCondition) {
      console.log(boxRow(`    ${chalk.green('\u2713')} ${chalk.gray(truncate(floor.successCondition, width - 12))}`, width));
    }
  }

  console.log(boxBottom(width));
  console.log('');

  // Feature 44: Dry run exits after showing the plan
  if (options?.dryRun) {
    console.log(chalk.green('  [DRY RUN] Blueprint displayed. No build started.'));
    console.log(chalk.gray(`  Goal ID: ${goalId}`));
    console.log(chalk.gray(`  To approve and build: askelira status ${goalId}`));
    console.log('');
    return;
  }

  // ── Step 7: Confirm approve ──────────────────────────────
  const { approve } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'approve',
      message: `Start building this ${planResult.floorCount}-floor plan?`,
      default: true,
    },
  ]);

  if (!approve) {
    console.log('');
    console.log(chalk.gray('  Blueprint saved. You can approve later:'));
    console.log(chalk.gray(`    askelira status ${goalId}`));
    console.log('');
    return;
  }

  // ── Step 8: Start building ───────────────────────────────
  const buildSpinner = ora('Starting the building loop...').start();

  try {
    const approveRes = await api.approveGoal(goalId);

    if (!approveRes.ok) {
      buildSpinner.fail(chalk.red('Failed to start building'));
      const errData = approveRes.data as unknown as { error?: string };
      console.log(chalk.red(`  ${errData?.error || `HTTP ${approveRes.status}`}`));
      process.exitCode = 1;
      return;
    }

    buildSpinner.succeed(chalk.green('Building started!'));

    console.log('');
    console.log(chalk.bold('  What happens next:'));
    console.log(`  ${chalk.cyan('1.')} Alba researches each floor`);
    console.log(`  ${chalk.cyan('2.')} Vex audits the research`);
    console.log(`  ${chalk.cyan('3.')} David builds the automation`);
    console.log(`  ${chalk.cyan('4.')} Vex audits the build`);
    console.log(`  ${chalk.cyan('5.')} Elira reviews and sets it live`);
    console.log(`  ${chalk.cyan('6.')} Steven monitors health continuously`);
    console.log('');
    console.log(chalk.bold('  Track progress:'));
    console.log(`  ${chalk.gray('Watch live:')}  askelira watch ${goalId}`);
    console.log(`  ${chalk.gray('Status:')}      askelira status ${goalId}`);
    console.log(`  ${chalk.gray('Logs:')}        askelira logs ${goalId} --tail`);
    console.log(`  ${chalk.gray('Floors:')}      askelira floors ${goalId}`);
    console.log('');
  } catch (err: unknown) {
    buildSpinner.fail(chalk.red('Connection error'));
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log(chalk.red(`  ${message}`));
    process.exitCode = 1;
  }
}

/**
 * Wrap text to fit within a given width.
 */
function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}
