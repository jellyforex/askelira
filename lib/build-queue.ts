/**
 * Build Queue -- Steven Delta SD-014
 *
 * Limits concurrent builds per user to prevent resource exhaustion.
 * In-memory tracking; resets on server restart.
 */

const MAX_CONCURRENT_BUILDS_PER_USER = 3;
const MAX_DAILY_BUILDS_PER_USER = 20;

interface UserBuildState {
  activeBuildCount: number;
  dailyBuildCount: number;
  lastResetDate: string; // YYYY-MM-DD
}

const userBuilds = new Map<string, UserBuildState>();

function getOrCreate(userId: string): UserBuildState {
  const today = new Date().toISOString().slice(0, 10);
  let state = userBuilds.get(userId);

  if (!state || state.lastResetDate !== today) {
    state = { activeBuildCount: 0, dailyBuildCount: 0, lastResetDate: today };
    userBuilds.set(userId, state);
  }

  return state;
}

export interface BuildQueueResult {
  allowed: boolean;
  reason?: string;
  activeBuilds: number;
  dailyBuilds: number;
}

/**
 * Check if a user can start a new build.
 */
export function canStartBuild(userId: string): BuildQueueResult {
  const state = getOrCreate(userId);

  if (state.activeBuildCount >= MAX_CONCURRENT_BUILDS_PER_USER) {
    return {
      allowed: false,
      reason: `Max ${MAX_CONCURRENT_BUILDS_PER_USER} concurrent builds reached. Wait for a build to complete.`,
      activeBuilds: state.activeBuildCount,
      dailyBuilds: state.dailyBuildCount,
    };
  }

  if (state.dailyBuildCount >= MAX_DAILY_BUILDS_PER_USER) {
    return {
      allowed: false,
      reason: `Daily build limit (${MAX_DAILY_BUILDS_PER_USER}) reached. Try again tomorrow.`,
      activeBuilds: state.activeBuildCount,
      dailyBuilds: state.dailyBuildCount,
    };
  }

  return {
    allowed: true,
    activeBuilds: state.activeBuildCount,
    dailyBuilds: state.dailyBuildCount,
  };
}

/**
 * Record that a build has started.
 */
export function recordBuildStart(userId: string): void {
  const state = getOrCreate(userId);
  state.activeBuildCount++;
  state.dailyBuildCount++;
}

/**
 * Record that a build has completed (or failed).
 */
export function recordBuildEnd(userId: string): void {
  const state = userBuilds.get(userId);
  if (state && state.activeBuildCount > 0) {
    state.activeBuildCount--;
  }
}
