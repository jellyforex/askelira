import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth-helpers';

export async function GET(req: NextRequest) {
  // Unified auth: support both NextAuth session (web) and header-based auth (CLI)
  const auth = await authenticate(req);
  if (!auth.authenticated || !auth.customerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      error: 'ANTHROPIC_API_KEY not configured',
    }, { status: 503 });
  }

  // Test API call
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Say test' }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await res.json();

    return NextResponse.json({
      status: res.status,
      ok: res.ok,
      response: data,
    });
  } catch (err: unknown) {
    console.error('[API /test-anthropic]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Anthropic API test failed' }, { status: 500 });
  }
}
