/**
 * Daily Intelligence Scraper — Phase 8 of AskElira 2.1
 *
 * Scrapes a category using Brave Search + URL fetcher to discover
 * automation patterns. NEVER throws — returns empty array on failure.
 */

import { braveSearch, type BraveResult } from './tools/brave-search';
import { fetchUrl } from './tools/url-fetcher';
import { callClaudeWithSystem } from './openclaw-client';
import { routeAgentCall } from './agent-router';

// ============================================================
// Types
// ============================================================

export interface ScrapedPattern {
  category: string;
  patternDescription: string;
  sourceUrl: string;
  implementationNotes: string;
  confidence: number;
}

// ============================================================
// Extraction prompt — small, cheap, fast
// ============================================================

const EXTRACTION_PROMPT = `You are a pattern extraction engine. Given web page content about an automation category, extract concrete, actionable automation patterns.

For each pattern found, return:
- patternDescription: one sentence describing WHAT is automated
- implementationNotes: 2-3 sentences on HOW to implement it (tools, APIs, steps)
- confidence: 0.3-0.8 based on how concrete and actionable the pattern is

Output valid JSON only. No markdown. No preamble.

{
  "patterns": [
    {
      "patternDescription": "string",
      "implementationNotes": "string",
      "confidence": number
    }
  ]
}

If no actionable patterns are found, return {"patterns": []}`;

// ============================================================
// Core scraping function
// ============================================================

/**
 * Scrape a single category for automation patterns.
 * Uses braveSearch for discovery, fetchUrl on top results, Claude for extraction.
 * NEVER throws — returns empty array on any failure.
 */
export async function scrapeCategory(category: string): Promise<ScrapedPattern[]> {
  try {
    const query = `${category} automation workflow best practices 2025 2026`;

    // Step 1: Brave Search — top 8 results
    let searchResults: BraveResult[];
    try {
      searchResults = await braveSearch(query, 8);
    } catch {
      console.warn(`[Scraper] Brave search failed for "${category}"`);
      return [];
    }

    if (searchResults.length === 0) {
      console.warn(`[Scraper] No search results for "${category}"`);
      return [];
    }

    // Step 2: Fetch top 3 URLs
    const top3 = searchResults.slice(0, 3);
    const fetchedPages: Array<{ url: string; content: string }> = [];

    for (const result of top3) {
      try {
        const content = await fetchUrl(result.url);
        if (content && content.length > 100) {
          fetchedPages.push({ url: result.url, content });
        }
      } catch {
        // Silent — skip failed URLs
      }
    }

    if (fetchedPages.length === 0) {
      // Fallback: use search snippets instead of full page content
      const snippetContent = searchResults
        .slice(0, 5)
        .map((r) => `[${r.title}] ${r.snippet} (${r.url})`)
        .join('\n\n');

      return extractFromContent(category, snippetContent, searchResults[0]?.url ?? '');
    }

    // Step 3: Extract patterns from each fetched page
    const allPatterns: ScrapedPattern[] = [];

    for (const page of fetchedPages) {
      try {
        const patterns = await extractFromContent(category, page.content, page.url);
        allPatterns.push(...patterns);
      } catch {
        // Silent — skip failed extraction
      }
    }

    // Deduplicate by patternDescription similarity (exact match)
    const seen = new Set<string>();
    const unique: ScrapedPattern[] = [];
    for (const p of allPatterns) {
      const key = p.patternDescription.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(p);
      }
    }

    return unique;
  } catch (err) {
    console.error(`[Scraper] Unexpected error for "${category}":`, err);
    return [];
  }
}

// ============================================================
// Content extraction helper
// ============================================================

async function extractFromContent(
  category: string,
  content: string,
  sourceUrl: string,
): Promise<ScrapedPattern[]> {
  try {
    // Cap content to avoid token overuse
    const trimmed = content.slice(0, 6000);

    const raw = await Promise.race([
      routeAgentCall({
        systemPrompt: EXTRACTION_PROMPT,
        userMessage: `Category: ${category}\n\nWeb Content:\n${trimmed}`,
        model: 'claude-sonnet-4-5-20250929',
        maxTokens: 1024,
        agentName: 'PatternExtractor',
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PatternExtractor call timed out after 30s')), 30_000),
      ),
    ]);

    // Parse JSON — handle markdown fences and preamble text
    let text = raw.trim();

    // Extract from markdown fences (even preceded by text)
    const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    } else if (text.startsWith('```')) {
      text = text.replace(/^```[a-z]*\n?/, '');
      text = text.replace(/\n?```\s*$/, '');
      text = text.trim();
    }

    // If text doesn't start with { or [, find the first one
    if (!text.startsWith('{') && !text.startsWith('[')) {
      const idx = text.indexOf('{');
      if (idx > 0) {
        const lastBrace = text.lastIndexOf('}');
        if (lastBrace > idx) {
          text = text.slice(idx, lastBrace + 1);
        }
      }
    }

    const parsed = JSON.parse(text) as {
      patterns: Array<{
        patternDescription: string;
        implementationNotes: string;
        confidence: number;
      }>;
    };

    if (!Array.isArray(parsed.patterns)) return [];

    return parsed.patterns
      .filter((p) => p.patternDescription && p.implementationNotes)
      .map((p) => ({
        category,
        patternDescription: p.patternDescription.slice(0, 500),
        sourceUrl,
        implementationNotes: p.implementationNotes.slice(0, 1000),
        confidence: Math.max(0.1, Math.min(0.8, p.confidence ?? 0.5)),
      }));
  } catch {
    return [];
  }
}
