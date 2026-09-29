const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const windowMs = 60_000;
const cacheMs = 30_000;
const requests: number[] = [];
const cache = new Map<string, { until: number; value: DiscoveryPage }>();
const inflight = new Map<string, Promise<DiscoveryPage>>();
let blockedUntil = 0;

export type BrowseFilters = {
  page: number;
  category?: string;
  onSale?: "true" | "false";
  sort: string;
};
export type DiscoveryPage = { data: ReturnType<typeof projectStartup>[]; page: number; hasMore: boolean };

export class DiscoveryError extends Error {
  readonly status: number;
  readonly retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function websiteDomain(value: unknown): { website: string; domain: string } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    const domain = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!domainPattern.test(domain)) return null;
    return { website: url.href, domain };
  } catch {
    return null;
  }
}

export function projectStartup(item: unknown) {
  if (!item || typeof item !== "object") throw new DiscoveryError(503, "TrustMRR returned an unexpected response.");
  const row = item as Record<string, unknown>;
  if (typeof row.slug !== "string" || !/^[a-z0-9-]{1,100}$/i.test(row.slug)
    || typeof row.name !== "string" || !row.name.trim()) {
    throw new DiscoveryError(503, "TrustMRR returned an unexpected response.");
  }
  const site = websiteDomain(row.website);
  return {
    name: row.name.slice(0, 160),
    slug: row.slug,
    description: typeof row.description === "string" ? row.description.slice(0, 200) : null,
    category: typeof row.category === "string" ? row.category.slice(0, 60) : null,
    website: site?.website ?? null,
    domain: site?.domain ?? null,
    listingUrl: `https://trustmrr.com/startup/${encodeURIComponent(row.slug)}`,
    onSale: row.onSale === true,
  };
}

function retrySeconds(now: number, until: number) {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

export async function browseTrustMrr(
  filters: BrowseFilters,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscoveryPage> {
  const key = JSON.stringify(filters);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.until > now) return cached.value;
  const existing = inflight.get(key);
  if (existing) return existing;
  // A single process-wide budget, not a per-user limit. Conservative even for premium keys.
  while (requests.length && requests[0] <= now - windowMs) requests.shift();
  if (now < blockedUntil) throw new DiscoveryError(429, "TrustMRR is temporarily rate limited. Please try again shortly.", retrySeconds(now, blockedUntil));
  if (requests.length >= 10) {
    throw new DiscoveryError(429, "Discovery is busy. Please try again shortly.", retrySeconds(now, requests[0] + windowMs));
  }
  requests.push(now);
  const work = (async () => {
    const url = new URL("https://trustmrr.com/api/v1/startups");
    url.searchParams.set("page", String(filters.page));
    url.searchParams.set("limit", "10");
    url.searchParams.set("sort", filters.sort);
    if (filters.category) url.searchParams.set("category", filters.category);
    if (filters.onSale) url.searchParams.set("onSale", filters.onSale);
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new DiscoveryError(503, "TrustMRR is unavailable. Please try again later.");
    }
    if (response.status === 429) {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      const retryHeader = Number(response.headers.get("retry-after"));
      const resetMs = Number.isFinite(reset) && reset > 0 ? (reset < 1e12 ? reset * 1000 : reset) : 0;
      blockedUntil = Math.max(Date.now() + (Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader * 1000 : 6000), resetMs);
      throw new DiscoveryError(429, "TrustMRR is temporarily rate limited. Please try again shortly.", retrySeconds(Date.now(), blockedUntil));
    }
    if (response.status === 401 || response.status === 403) {
      throw new DiscoveryError(503, "TrustMRR discovery is not available with the configured access.");
    }
    if (!response.ok) throw new DiscoveryError(503, "TrustMRR is unavailable. Please try again later.");
    const remaining = Number(response.headers.get("x-ratelimit-remaining"));
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(remaining) && remaining === 0 && Number.isFinite(reset) && reset > 0) {
      blockedUntil = Math.max(blockedUntil, reset < 1e12 ? reset * 1000 : reset);
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new DiscoveryError(503, "TrustMRR returned an unexpected response."); }
    if (!payload || typeof payload !== "object") throw new DiscoveryError(503, "TrustMRR returned an unexpected response.");
    const { data, meta } = payload as { data?: unknown; meta?: unknown };
    if (!Array.isArray(data) || data.length > 10 || !meta || typeof meta !== "object"
      || typeof (meta as { hasMore?: unknown }).hasMore !== "boolean") {
      throw new DiscoveryError(503, "TrustMRR returned an unexpected response.");
    }
    const value: DiscoveryPage = {
      data: data.map(projectStartup),
      page: filters.page,
      hasMore: (meta as { hasMore: boolean }).hasMore && filters.page < 20,
    };
    if (cache.size >= 100) cache.clear();
    cache.set(key, { until: Date.now() + cacheMs, value });
    return value;
  })();
  inflight.set(key, work);
  try { return await work; }
  finally { inflight.delete(key); }
}