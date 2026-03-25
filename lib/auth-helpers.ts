// ============================================================
// AskElira 2.1 — Auth Helpers
// ============================================================
// Unified authentication for both web (NextAuth session) and CLI (header-based auth).
// Supports dual auth modes:
// 1. Web: NextAuth session via Google OAuth
// 2. CLI: x-api-key + x-email header validation

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export interface AuthResult {
  authenticated: boolean;
  customerId: string | null;
  email: string | null;
  method: 'session' | 'header' | null;
}

/**
 * Unified authentication check for API routes.
 *
 * Checks both:
 * 1. NextAuth session (for web browser requests)
 * 2. Header-based auth (for CLI requests with x-api-key + x-email)
 *
 * @returns AuthResult with authentication status and user info
 */
export async function authenticate(req: NextRequest): Promise<AuthResult> {
  // Try NextAuth session first (web auth)
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    return {
      authenticated: true,
      customerId: session.user.email,
      email: session.user.email,
      method: 'session',
    };
  }

  // Fall back to header-based auth (CLI auth)
  const apiKey = req.headers.get('x-api-key');
  const email = req.headers.get('x-email');
  const customerId = req.headers.get('x-customer-id');

  // Validate header presence
  if (!apiKey || !email || !customerId) {
    return {
      authenticated: false,
      customerId: null,
      email: null,
      method: null,
    };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      authenticated: false,
      customerId: null,
      email: null,
      method: null,
    };
  }

  // Simple auth: apiKey must equal email (matching verify-key route logic)
  if (apiKey.trim() !== email.trim()) {
    return {
      authenticated: false,
      customerId: null,
      email: null,
      method: null,
    };
  }

  // Check admin access
  const adminEmail = process.env.ADMIN_EMAIL || '';
  if (adminEmail && email.toLowerCase() === adminEmail.toLowerCase()) {
    return {
      authenticated: true,
      customerId: `admin-${email.split('@')[0]}`,
      email: email,
      method: 'header',
    };
  }

  // Verify customer exists in database (optional - allows new customers)
  try {
    const { sql } = await import('@vercel/postgres');
    const result = await sql`
      SELECT customer_id FROM goals
      WHERE LOWER(customer_id) = ${email.toLowerCase()}
      LIMIT 1
    `;

    return {
      authenticated: true,
      customerId: result.rows.length > 0 ? result.rows[0].customer_id as string : email,
      email: email,
      method: 'header',
    };
  } catch (dbErr: unknown) {
    // DB unavailable - allow auth anyway (development fallback)
    console.warn(
      '[auth-helpers] DB unavailable, allowing header-based auth:',
      dbErr instanceof Error ? dbErr.message : dbErr,
    );
    return {
      authenticated: true,
      customerId: email,
      email: email,
      method: 'header',
    };
  }
}

/**
 * Get authenticated user's customer ID.
 * Throws error if not authenticated.
 */
export async function requireAuth(req: NextRequest): Promise<string> {
  const auth = await authenticate(req);
  if (!auth.authenticated || !auth.customerId) {
    throw new Error('Unauthorized');
  }
  return auth.customerId;
}
