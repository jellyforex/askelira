/**
 * Vercel Cron: Daily Intelligence Scraper — Phase 8
 * Schedule: 0 3 * * * (3am UTC daily)
 *
 * Shuffles categories, scrapes 10, upserts patterns, logs results.
 * Never throws — always returns a response.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max for Vercel

export async function GET(request: Request) {
  try {
    // Verify CRON_SECRET
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('[Scraper Cron] CRON_SECRET not set — rejecting request');
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Dynamic imports to avoid bundling issues
    const { SCRAPER_CATEGORIES } = await import('@/lib/scraper-categories');
    const { scrapeCategory } = await import('@/lib/daily-scraper');
    const { upsertPattern } = await import('@/lib/pattern-manager');
    const { logAgentAction } = await import('@/lib/building-manager');

    // Shuffle categories and take first 10
    const shuffled = [...SCRAPER_CATEGORIES].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 10);

    const results: Array<{
      category: string;
      patternsFound: number;
      upserted: number;
    }> = [];

    let totalPatterns = 0;
    let totalUpserted = 0;

    // Sequential scraping with 2000ms delay between categories
    for (const category of selected) {
      try {
        const patterns = await scrapeCategory(category);
        let upserted = 0;

        for (const pattern of patterns) {
          try {
            await upsertPattern(pattern);
            upserted++;
          } catch {
            // Silent — skip failed upserts
          }
        }

        results.push({
          category,
          patternsFound: patterns.length,
          upserted,
        });

        totalPatterns += patterns.length;
        totalUpserted += upserted;

        console.log(
          `[Scraper Cron] ${category}: ${patterns.length} found, ${upserted} upserted`,
        );
      } catch {
        results.push({ category, patternsFound: 0, upserted: 0 });
        console.warn(`[Scraper Cron] ${category}: failed`);
      }

      // 2 second delay between categories
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Log to agent_logs
    try {
      await logAgentAction({
        goalId: '00000000-0000-0000-0000-000000000000',
        agentName: 'Scraper',
        action: 'daily_scrape',
        outputSummary: `Scraped ${selected.length} categories: ${totalPatterns} patterns found, ${totalUpserted} upserted`,
      });
    } catch {
      // Silent — logging is best-effort
    }

    return NextResponse.json({
      ok: true,
      categoriesScraped: selected.length,
      totalPatterns,
      totalUpserted,
      results,
    });
  } catch (err) {
    console.error('[Scraper Cron] Fatal error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
