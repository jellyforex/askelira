/**
 * User Settings Endpoint
 *
 * GET  /api/user/update  — Load saved settings + plan info
 * POST /api/user/update  — Save user settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth-helpers';
import { logger } from '@/lib/logger';

// Valid timezones (subset — loose validation)
const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

interface UserSettingsPayload {
  displayName?: string;
  timezone?: string;
  notifyBuilds?: boolean;
  notifyErrors?: boolean;
  notifyWeeklyDigest?: boolean;
}

// ============================================================
// GET — Load settings + plan
// ============================================================

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth.authenticated || !auth.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = auth.email;
    const { sql } = await import('@vercel/postgres');

    // Ensure user_settings table exists
    await sql`
      CREATE TABLE IF NOT EXISTS user_settings (
        email TEXT PRIMARY KEY,
        display_name TEXT DEFAULT '',
        timezone TEXT DEFAULT 'America/New_York',
        notify_builds BOOLEAN DEFAULT true,
        notify_errors BOOLEAN DEFAULT true,
        notify_weekly_digest BOOLEAN DEFAULT false,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    const [settingsResult, usageResult] = await Promise.all([
      sql`SELECT * FROM user_settings WHERE email = ${email}`,
      sql`SELECT plan, debates_used FROM users WHERE email = ${email}`,
    ]);

    const row = settingsResult.rows[0];
    const settings = row
      ? {
          displayName: row.display_name || '',
          timezone: row.timezone || 'America/New_York',
          notifyBuilds: row.notify_builds ?? true,
          notifyErrors: row.notify_errors ?? true,
          notifyWeeklyDigest: row.notify_weekly_digest ?? false,
        }
      : null;

    const planRow = usageResult.rows[0];
    const plan = planRow
      ? { plan: planRow.plan || 'free', debatesUsed: planRow.debates_used || 0 }
      : { plan: 'free', debatesUsed: 0 };

    return NextResponse.json({ settings, plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load settings';
    logger.error('[API /user/update GET]', { error: message });
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

// ============================================================
// POST — Save settings
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth.authenticated || !auth.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = auth.email;
    const body: UserSettingsPayload = await req.json();

    // Validate
    const displayName = typeof body.displayName === 'string'
      ? body.displayName.trim().slice(0, 100)
      : '';

    const timezone = typeof body.timezone === 'string' && VALID_TIMEZONES.has(body.timezone)
      ? body.timezone
      : 'America/New_York';

    const notifyBuilds = typeof body.notifyBuilds === 'boolean' ? body.notifyBuilds : true;
    const notifyErrors = typeof body.notifyErrors === 'boolean' ? body.notifyErrors : true;
    const notifyWeeklyDigest = typeof body.notifyWeeklyDigest === 'boolean' ? body.notifyWeeklyDigest : false;

    const { sql } = await import('@vercel/postgres');

    // Ensure table exists
    await sql`
      CREATE TABLE IF NOT EXISTS user_settings (
        email TEXT PRIMARY KEY,
        display_name TEXT DEFAULT '',
        timezone TEXT DEFAULT 'America/New_York',
        notify_builds BOOLEAN DEFAULT true,
        notify_errors BOOLEAN DEFAULT true,
        notify_weekly_digest BOOLEAN DEFAULT false,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    // Upsert
    await sql`
      INSERT INTO user_settings (email, display_name, timezone, notify_builds, notify_errors, notify_weekly_digest, updated_at)
      VALUES (${email}, ${displayName}, ${timezone}, ${notifyBuilds}, ${notifyErrors}, ${notifyWeeklyDigest}, now())
      ON CONFLICT (email) DO UPDATE SET
        display_name = ${displayName},
        timezone = ${timezone},
        notify_builds = ${notifyBuilds},
        notify_errors = ${notifyErrors},
        notify_weekly_digest = ${notifyWeeklyDigest},
        updated_at = now()
    `;

    logger.info('[API /user/update POST] Settings saved', { userId: email });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save settings';
    logger.error('[API /user/update POST]', { error: message });
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
