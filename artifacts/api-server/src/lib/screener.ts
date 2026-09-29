type RawRow = Record<string, unknown>;

export type ShareItem = { label: string; share: number };
export type DomainProfile = {
  domain: string;
  monthlyVisits: { month: string; visits: number }[];
  averageVisits: number;
  trafficChangePercent: number | null;
  channels: ShareItem[];
  geography: ShareItem[];
  topCountry: ShareItem | null;
  topChannel: ShareItem | null;
};
export type Finding = {
  id: string;
  severity: "watch" | "context";
  title: string;
  metric: string;
  value: string;
  period: string;
  source: string;
  sourceUrl: string;
  whyItMatters: string;
  verificationQuestion: string;
};

const API = "https://api.similarweb.com/v5/website-analysis/websites";
export const TRAFFIC_DOC = "https://docs.similarweb.com/api-v5/api-reference/website-analysis-api/website-performance/traffic-and-engagement";
export const CHANNEL_DOC = "https://docs.similarweb.com/api-v5/api-reference/website-analysis-api/marketing-channels/marketing-channels-new";
export const GEO_DOC = "https://docs.similarweb.com/api-v5/api-reference/website-analysis-api/website-performance/traffic-geography";
const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export class ProviderError extends Error {
  provider: string;

  constructor(provider: string, message: string) {
    super(message);
    this.provider = provider;
  }
}

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    const configuredLimit = Number(process.env.DEALLENS_SIMILARWEB_MAX_CONCURRENCY);
    const limit = Number.isFinite(configuredLimit) && configuredLimit > 0
      ? Math.max(1, Math.min(16, Math.floor(configuredLimit)))
      : 6;
    const configuredQueue = Number(process.env.DEALLENS_SIMILARWEB_MAX_QUEUE);
    const queueLimit = Number.isFinite(configuredQueue) && configuredQueue >= 0
      ? Math.min(128, Math.floor(configuredQueue))
      : 48;
    if (this.active < limit) {
      this.active += 1;
    } else {
      if (this.waiters.length >= queueLimit) {
        throw new ProviderError("Similarweb", "The global provider request budget is currently full; retry shortly.");
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.active = Math.max(0, this.active - 1);
    };
  }
}

const similarwebSemaphore = new Semaphore();

export type FreshTrafficEstimate = {
  domain: string;
  metric: "Estimated monthly visits";
  visits: number;
  period: string;
  source: "Fresh Similarweb traffic-and-engagement estimate";
  sourceUrl: string;
  retrievedAt: string;
};

function monthOffset(offset: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    .toISOString().slice(0, 7);
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rows(payload: unknown, endpoint: string): RawRow[] {
  if (!payload || typeof payload !== "object") {
    throw new ProviderError("Similarweb", `${endpoint} returned an invalid response.`);
  }
  const body = payload as { meta?: { status?: string; error_message?: string }; data?: unknown };
  if (body.meta?.status && body.meta.status !== "success") {
    throw new ProviderError("Similarweb", `${endpoint}: ${body.meta.error_message || body.meta.status}`);
  }
  if (!Array.isArray(body.data)) {
    throw new ProviderError("Similarweb", `${endpoint} returned no usable data.`);
  }
  return body.data.filter((item): item is RawRow => !!item && typeof item === "object");
}

async function similarweb(path: string, domain: string, params: Record<string, string>): Promise<RawRow[]> {
  const key = process.env.SIMILARWEB_API_KEY;
  if (!key) throw new ProviderError("Similarweb", "API key is not configured.");
  const url = new URL(`${API}${path}`);
  for (const [name, value] of Object.entries({ domain, format: "json", ...params })) {
    url.searchParams.set(name, value);
  }
  const release = await similarwebSemaphore.acquire();
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "api-key": key },
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new ProviderError("Similarweb", "The request timed out or the provider is unreachable.");
    }
    if (!response.ok) {
      let body: string;
      try {
        body = await response.text();
      } catch {
        throw new ProviderError("Similarweb", "The provider failed while returning traffic data.");
      }
      let message = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(body) as { message?: string; error?: string; meta?: { error_message?: string } };
        message += `: ${(parsed.meta?.error_message || parsed.message || parsed.error || "check API entitlement and query parameters").slice(0, 180)}`;
      } catch {
        message += ": check API entitlement and query parameters";
      }
      throw new ProviderError("Similarweb", message);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderError("Similarweb", `${path} returned an invalid JSON response.`);
    }
    return rows(payload, path);
  } finally {
    release();
  }
}

export async function fetchFreshTrafficEstimate(domain: string): Promise<FreshTrafficEstimate> {
  if (!domainPattern.test(domain)) {
    throw new ProviderError("Similarweb", "The saved target domain is invalid for a fresh lookup.");
  }
  const month = monthOffset(1);
  const traffic = await similarweb("/traffic-and-engagement", domain, {
    start_date: month,
    end_date: month,
    granularity: "monthly",
    web_source: "total",
    country: "ww",
    metrics: "visits",
  });
  const point = traffic.find((row) =>
    String(row.date ?? "").slice(0, 7) === month && number(row.visits) !== null);
  const visits = number(point?.visits);
  if (visits === null) {
    throw new ProviderError("Similarweb", `No current monthly visits estimate was available for ${domain} (${month}).`);
  }
  return {
    domain,
    metric: "Estimated monthly visits",
    visits,
    period: `${month} (one month, worldwide, all web)`,
    source: "Fresh Similarweb traffic-and-engagement estimate",
    sourceUrl: TRAFFIC_DOC,
    retrievedAt: new Date().toISOString(),
  };
}

export async function fetchProfile(domain: string, start: string, end: string): Promise<DomainProfile> {
  const common = {
    start_date: start,
    end_date: end,
    granularity: "monthly",
    web_source: "total",
  };
  // Sequential per domain keeps simultaneous provider requests to two.
  const traffic = await similarweb("/traffic-and-engagement", domain, {
    ...common, country: "ww", metrics: "visits",
  });
  const channels = await similarweb("/traffic-channels", domain, {
    ...common, country: "ww",
  });
  const geography = await similarweb("/geography/aggregated", domain, {
    ...common, metrics: "share", limit: "20", offset: "0",
  });
  const monthlyVisits = traffic
    .map((r) => ({ month: String(r.date ?? "").slice(0, 7), visits: number(r.visits) }))
    .filter((r): r is { month: string; visits: number } => /^\d{4}-\d{2}$/.test(r.month) && r.visits !== null)
    .sort((a, b) => a.month.localeCompare(b.month));
  if (monthlyVisits.length < 1) {
    throw new ProviderError("Similarweb", `No recent monthly visits were available for ${domain}. Try a larger domain.`);
  }
  const channelItems = channels
    .filter((r) => typeof r.source_type === "string" && number(r.visits) !== null)
    .reduce<Map<string, number>>((map, row) => {
      const label = String(row.source_type);
      map.set(label, (map.get(label) || 0) + (number(row.visits) || 0));
      return map;
    }, new Map());
  const channelTotal = [...channelItems.values()].reduce((sum, visits) => sum + visits, 0);
  const channelShares = [...channelItems].map(([label, visits]) => ({ label, share: channelTotal ? visits / channelTotal : 0 }))
    .sort((a, b) => b.share - a.share);
  const geoShares = geography
    .filter((r) => typeof r.country_name === "string" && number(r.share) !== null)
    .map((r) => ({ label: String(r.country_name), share: number(r.share)! }))
    .sort((a, b) => b.share - a.share);
  const first = monthlyVisits[0].visits;
  const last = monthlyVisits.at(-1)!.visits;
  return {
    domain,
    monthlyVisits,
    averageVisits: monthlyVisits.reduce((sum, r) => sum + r.visits, 0) / monthlyVisits.length,
    trafficChangePercent: monthlyVisits.length > 1 && first > 0 ? (last / first - 1) * 100 : null,
    channels: channelShares,
    geography: geoShares,
    topChannel: channelShares[0] || null,
    topCountry: geoShares[0] || null,
  };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function findingsFor(target: DomainProfile, comparison: DomainProfile, period: string): Finding[] {
  const results: Finding[] = [];
  const add = (f: Omit<Finding, "id" | "source">) => results.push({
    id: `F${results.length + 1}`,
    source: "Similarweb estimate",
    ...f,
  });
  if (target.trafficChangePercent !== null && target.trafficChangePercent <= -20) {
    add({
      severity: "watch", title: "Recent traffic decline", metric: "Estimated visits change",
      value: `${target.trafficChangePercent.toFixed(1)}%`, period, sourceUrl: TRAFFIC_DOC,
      whyItMatters: "A decline in estimated visits merits checking whether customer acquisition and revenue followed the same direction.",
      verificationQuestion: "Can the seller share monthly GA4 sessions, qualified leads, and revenue for this period and explain any change?",
    });
  }
  if (target.topChannel && target.topChannel.share >= 0.6) {
    add({
      severity: "watch", title: "Channel concentration", metric: `${target.topChannel.label} share`,
      value: percent(target.topChannel.share), period, sourceUrl: CHANNEL_DOC,
      whyItMatters: "A large share from one acquisition channel can make growth sensitive to changes in that channel.",
      verificationQuestion: `Can the seller provide GA4 acquisition and conversion reports for ${target.topChannel.label} over the last 12 months?`,
    });
  }
  if (target.topCountry && target.topCountry.share >= 0.6) {
    add({
      severity: "watch", title: "Geographic concentration", metric: `${target.topCountry.label} traffic share`,
      value: percent(target.topCountry.share), period, sourceUrl: GEO_DOC,
      whyItMatters: "Audience location is not revenue location; the gap needs validation against customer economics.",
      verificationQuestion: `Can the seller share customers and revenue by country alongside GA4 traffic by country, especially ${target.topCountry.label}?`,
    });
  }
  if (comparison.averageVisits > 0) {
    add({
      severity: "context", title: "Peer traffic benchmark", metric: "Average estimated monthly visits",
      value: `${Math.round(target.averageVisits).toLocaleString()} vs ${Math.round(comparison.averageVisits).toLocaleString()}`,
      period, sourceUrl: TRAFFIC_DOC,
      whyItMatters: "Traffic scale adds context, but different business models and conversion rates make it an imperfect comparison.",
      verificationQuestion: "What are each company's relevant market, buyer profile, and visitor-to-customer conversion rates?",
    });
  }
  if (!results.some((f) => f.severity === "watch")) {
    add({
      severity: "context", title: "No threshold-based concentration flagged",
      metric: "Available traffic signals", value: "No preset threshold crossed",
      period, sourceUrl: TRAFFIC_DOC,
      whyItMatters: "This does not establish business quality; the screen only evaluates a few external traffic estimates.",
      verificationQuestion: "Can the seller share first-party analytics and revenue data so these estimates can be checked?",
    });
  }
  return results;
}

export async function generateBrief(target: DomainProfile, comparison: DomainProfile, findings: Finding[]): Promise<string> {
  const key = process.env.CRUSOE_API_KEY;
  if (!key) throw new ProviderError("Crusoe", "API key is not configured.");
  const facts = {
    target: target.domain,
    peer: comparison.domain,
    targetAverageMonthlyVisits: Math.round(target.averageVisits),
    peerAverageMonthlyVisits: Math.round(comparison.averageVisits),
    flags: findings.map(({ title, metric, value, period, whyItMatters }) => ({ title, metric, value, period, whyItMatters })),
  };
  let response: Response;
  try {
    response = await fetch("https://api.inference.crusoecloud.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model: "deepseek-ai/Deepseek-V4-Flash",
        temperature: 0.1,
        max_tokens: 220,
        messages: [
          { role: "system", content: "You are a cautious acquisition research analyst. Write a 2-3 sentence first-pass screening brief using ONLY the supplied facts. Do not infer revenue, fraud, intent, causation, or investment advice. These traffic values are external estimates, not first-party evidence. Do not invent any numbers. Recommend verification with seller analytics. Return plain text only." },
          { role: "user", content: JSON.stringify(facts) },
        ],
      }),
    });
  } catch {
    throw new ProviderError("Crusoe", "The inference request timed out or the provider is unreachable.");
  }
  if (!response.ok) {
    throw new ProviderError("Crusoe", `Inference request failed (HTTP ${response.status}); check model access and account limits.`);
  }
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new ProviderError("Crusoe", "The model returned an empty brief.");
  return text.slice(0, 1200);
}

export function screenPeriod(): { start: string; end: string; label: string } {
  // Skip the newest completed month so delayed provider updates cannot silently produce partial data.
  const start = monthOffset(4);
  const end = monthOffset(2);
  return { start, end, label: `${start} to ${end} (monthly, worldwide, all web)` };
}

export async function fetchProfiles(target: string, comparison: string, start: string, end: string) {
  return Promise.all([fetchProfile(target, start, end), fetchProfile(comparison, start, end)]);
}