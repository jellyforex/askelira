// lib/tools/brave-search.ts
// Real web search via Brave Search API
// Requires env var: BRAVE_SEARCH_API_KEY

export interface BraveResult {
  title: string;
  url: string;
  snippet: string;
}

export async function braveSearch(query: string, count = 5): Promise<BraveResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY not set");

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  const res = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!res.ok) throw new Error(`Brave Search error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const results = data?.web?.results ?? [];

  return results.slice(0, count).map((r: any) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}
