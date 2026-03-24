import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import fs from 'fs/promises';
import path from 'path';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const configPath = path.join(process.cwd(), '.autonomous-config.json');

  let config = null;
  let configured = false;

  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(raw);
    configured = true;
  } catch {
    // config missing or malformed
  }

  // Check for recent history
  const historyPath = path.join(process.cwd(), 'logs/autonomous-history.json');
  let lastRun = null;
  let totalIterations = 0;

  try {
    const raw = await fs.readFile(historyPath, 'utf-8');
    const history = JSON.parse(raw);
    totalIterations = history.length;
    if (history.length > 0) {
      lastRun = history[history.length - 1].timestamp;
    }
  } catch {
    // history missing or malformed
  }

  return NextResponse.json({
    configured,
    enabled: config?.enabled ?? false,
    config: config
      ? {
          loopInterval: config.loopInterval,
          agentCount: config.agentCount,
          maxIterations: config.maxIterations,
          // NOTE: allowedPaths intentionally omitted to avoid leaking server paths
        }
      : null,
    lastRun,
    totalIterations,
  });
}
