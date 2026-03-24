import { NextRequest, NextResponse } from 'next/server';

// SD-017: Request size limit (1MB)
const MAX_REQUEST_SIZE = 1_048_576;

const RATE_LIMIT_WINDOW = 60_000; // 1 minute
// Local development: 1000 req/min, Production: 100 req/min
const MAX_REQUESTS = process.env.NODE_ENV === 'development' ? 1000 : 100;

const requestLog = new Map<string, number[]>();

// Auto-cleanup stale entries every 5 minutes to prevent memory leaks.
// On Vercel Edge this is short-lived anyway, but on the custom server.js
// (local dev / self-hosted) the Map could grow without bound.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of requestLog) {
      const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
      if (recent.length === 0) {
        requestLog.delete(ip);
      } else {
        requestLog.set(ip, recent);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Unref so it doesn't keep Node.js alive
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    (cleanupTimer as NodeJS.Timeout).unref();
  }
}

export function middleware(req: NextRequest) {
  // Only rate-limit API routes
  if (!req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Skip auth routes
  if (req.nextUrl.pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';

  // Skip rate limiting for localhost only (never skip for 'unknown' — that
  // would let attackers bypass rate limiting by stripping forwarding headers)
  if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1') {
    return NextResponse.next();
  }

  // SD-017: Reject oversized requests
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
    return NextResponse.json(
      { error: 'Request body too large. Maximum 1MB.' },
      { status: 413 },
    );
  }

  ensureCleanup();

  const now = Date.now();
  const timestamps = requestLog.get(ip) ?? [];

  // Prune entries outside the window
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);

  if (recent.length >= MAX_REQUESTS) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(MAX_REQUESTS),
          'X-RateLimit-Remaining': '0',
          'Retry-After': '60',
        },
      },
    );
  }

  recent.push(now);
  requestLog.set(ip, recent);

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Limit', String(MAX_REQUESTS));
  response.headers.set('X-RateLimit-Remaining', String(MAX_REQUESTS - recent.length));

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
