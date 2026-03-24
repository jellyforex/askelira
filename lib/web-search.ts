/**
 * Web Search Integration for AskElira Agents
 * Provides real-time web research capabilities to Alba, OpenClaw, and Phase 0
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  relevanceScore?: number;
}

export interface WebSearchOptions {
  query: string;
  count?: number; // Number of results (default: 5)
  freshness?: 'day' | 'week' | 'month' | 'year'; // Recency filter
  provider?: 'brave' | 'tavily' | 'perplexity' | 'auto'; // Explicit provider selection (default: 'auto')
}

/**
 * Brave Search API integration
 * Get your API key from: https://brave.com/search/api/
 */
export async function braveSearch(options: WebSearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!apiKey) {
    console.warn('[WebSearch] BRAVE_SEARCH_API_KEY not set - skipping web search');
    return [];
  }

  const { query, count = 5, freshness } = options;

  try {
    const params = new URLSearchParams({
      q: query,
      count: count.toString(),
    });

    if (freshness) {
      params.append('freshness', freshness);
    }

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      console.error('[WebSearch] Brave API error:', response.status);
      return [];
    }

    const data = await response.json() as any;

    if (!data.web?.results) {
      return [];
    }

    return data.web.results.map((result: any) => ({
      title: result.title || '',
      url: result.url || '',
      snippet: result.description || '',
    }));
  } catch (error) {
    console.error('[WebSearch] Search failed:', error);
    return [];
  }
}

/**
 * Perplexity API integration (alternative to Brave)
 * Get your API key from: https://www.perplexity.ai/settings/api
 */
export async function perplexitySearch(options: WebSearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) {
    console.warn('[WebSearch] PERPLEXITY_API_KEY not set - skipping web search');
    return [];
  }

  const { query } = options;

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [
          {
            role: 'user',
            content: query,
          },
        ],
        return_citations: true,
        return_related_questions: false,
      }),
    });

    if (!response.ok) {
      console.error('[WebSearch] Perplexity API error:', response.status);
      return [];
    }

    const data = await response.json() as any;

    if (!data.citations || !Array.isArray(data.citations)) {
      return [];
    }

    return data.citations.map((url: string, index: number) => ({
      title: `Source ${index + 1}`,
      url,
      snippet: data.choices?.[0]?.message?.content || '',
    }));
  } catch (error) {
    console.error('[WebSearch] Search failed:', error);
    return [];
  }
}

/**
 * Tavily Search API integration
 * Get your API key from: https://tavily.com
 */
export async function tavilySearch(options: WebSearchOptions): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    console.warn('[WebSearch] TAVILY_API_KEY not set - skipping Tavily search');
    return [];
  }

  const { query, count = 5, freshness } = options;

  try {
    const body: Record<string, unknown> = {
      api_key: apiKey,
      query,
      max_results: count,
      include_answer: false,
      include_raw_content: false,
    };

    // Map freshness to Tavily's days parameter
    if (freshness) {
      const freshnessMap: Record<string, number> = {
        day: 1,
        week: 7,
        month: 30,
        year: 365,
      };
      body.days = freshnessMap[freshness] || 30;
    }

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error('[WebSearch] Tavily API error:', response.status);
      return [];
    }

    const data = await response.json() as any;

    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    return data.results.map((result: any) => ({
      title: result.title || '',
      url: result.url || '',
      snippet: result.content || '',
      relevanceScore: result.score,
    }));
  } catch (error) {
    console.error('[WebSearch] Tavily search failed:', error);
    return [];
  }
}

/**
 * Generic web search that tries available providers in order.
 * When provider is 'auto' (default), tries Brave -> Tavily -> Perplexity based on available keys.
 */
export async function webSearch(options: WebSearchOptions): Promise<SearchResult[]> {
  const provider = options.provider || process.env.SEARCH_PROVIDER || 'auto';

  // Explicit provider selection
  if (provider === 'brave') {
    return braveSearch(options);
  }
  if (provider === 'tavily') {
    return tavilySearch(options);
  }
  if (provider === 'perplexity') {
    return perplexitySearch(options);
  }

  // Auto mode: try providers in order based on available keys
  if (process.env.BRAVE_SEARCH_API_KEY) {
    const results = await braveSearch(options);
    if (results.length > 0) {
      return results;
    }
  }

  // Try Tavily second
  if (process.env.TAVILY_API_KEY) {
    const results = await tavilySearch(options);
    if (results.length > 0) {
      return results;
    }
  }

  // Fallback to Perplexity
  if (process.env.PERPLEXITY_API_KEY) {
    return await perplexitySearch(options);
  }

  console.warn('[WebSearch] No search API configured - agents running offline');
  return [];
}

/**
 * Specialized search for package verification
 */
export async function searchPackageInfo(packageName: string, provider?: WebSearchOptions['provider']): Promise<{
  npmWeeklyDownloads?: string;
  githubStars?: string;
  latestVersion?: string;
  lastUpdated?: string;
  knownVulnerabilities?: string[];
}> {
  const queries = [
    `${packageName} npm downloads statistics 2026`,
    `${packageName} security vulnerabilities CVE`,
    `${packageName} github stars maintenance`,
  ];

  const allResults: SearchResult[] = [];

  for (const query of queries) {
    const results = await webSearch({ query, count: 3, freshness: 'month', provider });
    allResults.push(...results);
  }

  // Parse results to extract structured data
  const info: any = {};

  allResults.forEach((result) => {
    const text = `${result.title} ${result.snippet}`.toLowerCase();

    // Extract download numbers
    const downloadMatch = text.match(/(\d+[\d,]*)\s*(million|k|thousand)?\s*downloads?\s*(?:per\s*)?(week|month)/i);
    if (downloadMatch && !info.npmWeeklyDownloads) {
      info.npmWeeklyDownloads = downloadMatch[0];
    }

    // Extract GitHub stars
    const starsMatch = text.match(/(\d+[\d,]*)\s*stars?/i);
    if (starsMatch && !info.githubStars) {
      info.githubStars = starsMatch[0];
    }

    // Check for vulnerabilities
    if (text.includes('vulnerability') || text.includes('cve-')) {
      if (!info.knownVulnerabilities) {
        info.knownVulnerabilities = [];
      }
      const cveMatch = text.match(/cve-\d{4}-\d+/gi);
      if (cveMatch) {
        info.knownVulnerabilities.push(...cveMatch);
      }
    }

    // Last updated
    if (text.includes('updated') || text.includes('maintained')) {
      const dateMatch = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i);
      if (dateMatch && !info.lastUpdated) {
        info.lastUpdated = dateMatch[0];
      }
    }
  });

  return info;
}
