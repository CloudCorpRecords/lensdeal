import { Router, type IRouter } from "express";
import { CreateScreenBody, CreateScreenResponse } from "@workspace/api-zod";
import { fetchProfiles, findingsFor, generateBrief, ProviderError, screenPeriod } from "../lib/screener";

const router: IRouter = Router();
const cache = new Map<string, { until: number; report: unknown }>();
const profileCache = new Map<string, { until: number; profiles: Awaited<ReturnType<typeof fetchProfiles>> }>();
const usage = new Map<string, { day: string; count: number }>();
let dailyUsage = { day: "", count: 0 };
const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function normalize(value: string): string {
  const trimmed = value.trim().toLowerCase();
  // Accept a pasted URL, but never fetch it: only its hostname goes into a fixed provider URL.
  const hostname = trimmed.includes("://") ? new URL(trimmed).hostname : trimmed.split("/")[0];
  return hostname.replace(/^www\./, "").replace(/\.$/, "");
}

router.post("/screen", async (req, res): Promise<void> => {
  const parsed = CreateScreenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter two valid domains." });
    return;
  }
  let targetDomain: string;
  let comparisonDomain: string;
  try {
    targetDomain = normalize(parsed.data.targetDomain);
    comparisonDomain = normalize(parsed.data.comparisonDomain);
  } catch {
    res.status(400).json({ error: "Enter two valid domain names or website URLs." });
    return;
  }
  if (!domainPattern.test(targetDomain) || !domainPattern.test(comparisonDomain) || targetDomain === comparisonDomain) {
    res.status(400).json({ error: "Enter two different, valid website domains." });
    return;
  }
  const period = screenPeriod();
  const cacheKey = `${targetDomain}|${comparisonDomain}|${period.start}|${period.end}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.until > Date.now()) {
    res.json(cached.report);
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  const ip = req.ip || "unknown";
  const clientUsage = usage.get(ip);
  const count = clientUsage?.day === day ? clientUsage.count : 0;
  if (dailyUsage.day !== day) dailyUsage = { day, count: 0 };
  if (count >= 10 || dailyUsage.count >= 40) {
    res.status(429).json({ error: "Daily live-screen limit reached to protect provider credits. Try again tomorrow." });
    return;
  }
  usage.set(ip, { day, count: count + 1 });
  dailyUsage.count += 1;
  try {
    let savedProfiles = profileCache.get(cacheKey);
    if (!savedProfiles || savedProfiles.until <= Date.now()) {
      const profiles = await fetchProfiles(targetDomain, comparisonDomain, period.start, period.end);
      savedProfiles = { until: Date.now() + 20 * 60_000, profiles };
      profileCache.set(cacheKey, savedProfiles);
    }
    const [target, comparison] = savedProfiles.profiles;
    const findings = findingsFor(target, comparison, period.label);
    const summary = await generateBrief(target, comparison, findings);
    const report = CreateScreenResponse.parse({
      generatedAt: new Date().toISOString(),
      period: period.label,
      sourceNotice: "Live Similarweb estimates analyzed with Crusoe. Not seller-provided analytics.",
      target,
      comparison,
      findings,
      summary,
      sellerQuestions: [...new Set(findings.map((finding) => finding.verificationQuestion))],
      limitations: [
        "Similarweb traffic is modeled third-party data, not proof of visits, revenue, customers, or misconduct.",
        "Small websites may have limited or less reliable estimates. Compare findings with GA4, payment, and customer records.",
        "This is a screening aid, not financial, legal, or investment advice.",
      ],
    });
    cache.set(cacheKey, { until: Date.now() + 20 * 60_000, report });
    if (cache.size > 100) {
      for (const [key, value] of cache) if (value.until <= Date.now()) cache.delete(key);
    }
    res.json(report);
  } catch (error) {
    if (error instanceof ProviderError) {
      req.log.warn({ provider: error.provider, message: error.message }, "Screen provider failed");
      res.status(502).json({ error: `${error.provider}: ${error.message}` });
      return;
    }
    req.log.error({ err: error }, "Screen failed");
    res.status(500).json({ error: "Could not complete the screen." });
  }
});

export default router;