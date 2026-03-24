/**
 * Manual scrape trigger — Phase 8
 * POST /api/cron/scrape-patterns/manual
 * Body: { categories?: string[], count?: number }
 *
 * For testing: manually trigger a scrape for specific categories or random ones.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    // Auth: require CRON_SECRET (same as daily cron route)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error('[Manual Scrape] CRON_SECRET not set — rejecting request');
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { SCRAPER_CATEGORIES } = await import('@/lib/scraper-categories');
    const { scrapeCategory } = await import('@/lib/daily-scraper');
    const { upsertPattern } = await import('@/lib/pattern-manager');

    let selected: string[];

    if (body.categories && Array.isArray(body.categories)) {
      selected = body.categories;
    } else {
      const rawCount = typeof body.count === 'number' ? body.count : 3;
      const count = Math.max(1, Math.min(rawCount, 20)); // Cap at 20 categories max
      const shuffled = [...SCRAPER_CATEGORIES].sort(() => Math.random() - 0.5);
      selected = shuffled.slice(0, count);
    }

    const results: Array<{
      category: string;
      patternsFound: number;
      upserted: number;
    }> = [];

    let totalPatterns = 0;
    let totalUpserted = 0;

    for (const category of selected) {
      try {
        const patterns = await scrapeCategory(category);
        let upserted = 0;

        for (const pattern of patterns) {
          try {
            await upsertPattern(pattern);
            upserted++;
          } catch {
            // Silent
          }
        }

        results.push({ category, patternsFound: patterns.length, upserted });
        totalPatterns += patterns.length;
        totalUpserted += upserted;

        console.log(`[Manual Scrape] ${category}: ${patterns.length} found, ${upserted} upserted`);
      } catch {
        results.push({ category, patternsFound: 0, upserted: 0 });
      }

      // 2 second delay between categories
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return NextResponse.json({
      ok: true,
      categoriesScraped: selected.length,
      totalPatterns,
      totalUpserted,
      results,
    });
  } catch (err) {
    console.error('[Manual Scrape] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
