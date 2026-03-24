/**
 * Next.js 14 Instrumentation Hook
 *
 * Called once when the server starts. Used to validate environment
 * and recover heartbeats for goals that were actively being monitored
 * before a restart.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Phase 10: Validate environment before anything else
    try {
      const { validateEnvironment } = await import('./lib/env-validator');
      validateEnvironment();
    } catch (err) {
      console.error('[Instrumentation] Environment validation failed:', err);
      // In production this throws and prevents startup.
      // In dev it only warns, so we continue.
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
    }

  }
}
