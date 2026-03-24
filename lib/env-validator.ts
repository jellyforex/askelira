/**
 * Environment Validator -- Phase 10 of AskElira 2.1
 *
 * Validates required and recommended environment variables at startup.
 * In production: throws on missing required vars.
 * In dev: warns only.
 */

interface ValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

const REQUIRED_VARS = [
  'ANTHROPIC_API_KEY',
  'POSTGRES_URL',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
];

const RECOMMENDED_VARS = [
  'BRAVE_SEARCH_API_KEY',
  'TAVILY_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'CRON_SECRET',
  'ADMIN_EMAIL',
];

export function validateEnvironment(): ValidationResult {
  const isProduction = process.env.NODE_ENV === 'production';
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required vars
  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Check recommended vars
  for (const varName of RECOMMENDED_VARS) {
    if (!process.env[varName]) {
      warnings.push(varName);
    }
  }

  // [BUG-5-08] Log ALL diagnostic info BEFORE throwing.
  // Previously, the throw for missing required vars happened before the
  // recommended vars warning was logged, so operators only saw the required
  // error and missed which recommended vars were also absent.
  if (warnings.length > 0) {
    console.warn(
      `[EnvValidator] Missing recommended vars: ${warnings.join(', ')} -- some features will be disabled`,
    );
  }

  if (missing.length > 0) {
    const msg = `[EnvValidator] Missing required vars: ${missing.join(', ')}`;
    if (isProduction) {
      console.error(msg);
      throw new Error(msg);
    } else {
      console.warn(`${msg} (dev mode -- continuing with warnings)`);
    }
  }

  if (missing.length === 0 && warnings.length === 0) {
    console.log('[EnvValidator] All environment variables present');
  }

  // SD-020: API key rotation reminder
  if (isProduction) {
    const rotationVars = ['ANTHROPIC_API_KEY', 'CRON_SECRET', 'NEXTAUTH_SECRET'];
    for (const varName of rotationVars) {
      if (process.env[varName]) {
        const val = process.env[varName]!;
        // Warn if key looks like a placeholder or is suspiciously short
        if (val.length < 16 || val.includes('...') || val === 'change-me') {
          console.warn(
            `[EnvValidator] ${varName} appears to be a placeholder — rotate it before production use`,
          );
        }
      }
    }
    console.log(
      '[EnvValidator] Reminder: Rotate API keys (ANTHROPIC_API_KEY, CRON_SECRET, NEXTAUTH_SECRET) at least every 90 days',
    );
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}
