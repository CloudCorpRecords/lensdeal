import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { CreateScreenBody, CreateScreenResponse } from "@workspace/api-zod";
import { db, requestIdempotency, savedScreens } from "@workspace/db";
import { accountId, requireAuth } from "../middlewares/requireAuth";
import {
  fetchProfile,
  findingsFor,
  generateBrief,
  ProviderError,
  screenPeriod,
} from "../lib/screener";
import {
  accountPeriod,
  fingerprintRequest,
  makeCachedResponse,
  ReservationLeaseLostError,
  reserveUsage,
  refundReservation,
} from "../lib/usage";

const router: IRouter = Router();
const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function normalize(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const hostname = trimmed.includes("://") ? new URL(trimmed).hostname : trimmed.split("/")[0];
  return hostname.replace(/^www\./, "").replace(/\.$/, "");
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      result[index] = await worker(values[index]);
    }
  }));
  return result;
}

router.use(requireAuth);

router.post("/screen", async (req, res): Promise<void> => {
  const parsed = CreateScreenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid target domain and one or more comparison domains." });
    return;
  }
  if (!parsed.data.requestId) {
    res.status(400).json({ error: "requestId is required for idempotent screen requests." });
    return;
  }

  let targetDomain: string;
  let comparisonDomains: string[];
  try {
    targetDomain = normalize(parsed.data.targetDomain);
    const candidates = parsed.data.comparisonDomains
      ?? (parsed.data.comparisonDomain ? [parsed.data.comparisonDomain] : []);
    comparisonDomains = [...new Set(candidates.map(normalize))];
  } catch {
    res.status(400).json({ error: "Enter valid domain names or website URLs." });
    return;
  }
  if (!domainPattern.test(targetDomain) || comparisonDomains.length === 0
    || comparisonDomains.some((domain) => !domainPattern.test(domain) || domain === targetDomain)) {
    res.status(400).json({ error: "Enter distinct, valid target and comparison domains." });
    return;
  }

  const owner = accountId(res);
  const units = comparisonDomains.length;
  const requestId = parsed.data.requestId;
  const fingerprint = fingerprintRequest({ targetDomain, comparisonDomains });
  const reservation = await reserveUsage(owner, "screens", units, requestId, fingerprint);
  if (reservation.conflict) {
    res.status(409).json({ error: "This requestId was already used for different screen input." });
    return;
  }
  if (!reservation.ok) {
    res.status(reservation.pending ? 409 : 429).json({
      error: reservation.pending ? "A request with this requestId is already being processed."
        : `Screen usage limit reached (${reservation.used ?? 0}/${reservation.limit ?? 10}).`,
    });
    return;
  }
  if (reservation.duplicate && reservation.cachedResponse) {
    const cached = reservation.cachedResponse as {
      target?: { domain?: string };
      comparison?: { domain?: string };
      additionalProfiles?: Array<{ domain?: string }>;
    };
    const cachedDomains = [cached.comparison?.domain, ...(cached.additionalProfiles || []).map((profile) => profile.domain)];
    if (cached.target?.domain !== targetDomain || cachedDomains.length !== comparisonDomains.length
      || cachedDomains.some((domain, index) => domain !== comparisonDomains[index])) {
      res.status(409).json({ error: "This requestId was already used for different screen input." });
      return;
    }
    res.json(reservation.cachedResponse);
    return;
  }
  let persisted = false;
  try {
    const serverComparisonCap = Math.max(1, Math.min(30, Number(process.env.DEALLENS_MAX_COMPARISONS_PER_SCREEN) || 8));
    if (comparisonDomains.length > serverComparisonCap) {
      await refundReservation(owner, "screens", units, reservation.periodStart, requestId, reservation.reservationId);
      res.status(413).json({
        error: `This request exceeds the server-side provider spend cap of ${serverComparisonCap} comparisons. Split it into smaller screens.`,
      });
      return;
    }
    const entitlement = await accountPeriod(owner);
    if (comparisonDomains.length > 1 && entitlement.tier !== "enterprise") {
      await refundReservation(owner, "screens", units, reservation.periodStart, requestId, reservation.reservationId);
      res.status(403).json({ error: "Multi-domain comparisons require an active Enterprise subscription." });
      return;
    }
    const period = screenPeriod();
    const profiles = await mapWithConcurrency(comparisonDomains, 3, async (domain) =>
      fetchProfile(domain, period.start, period.end));
    const target = await fetchProfile(targetDomain, period.start, period.end);
    const comparison = profiles[0];
    const findings = profiles.flatMap((profile, profileIndex) =>
      findingsFor(target, profile, period.label).map((finding, findingIndex) => ({
        ...finding,
        id: `F${profileIndex + 1}.${findingIndex + 1}`,
      })),
    );
    const summary = await generateBrief(target, comparison, findingsFor(target, comparison, period.label));
    const id = randomUUID();
    const report = CreateScreenResponse.parse({
      id,
      generatedAt: new Date().toISOString(),
      period: period.label,
      sourceNotice: "Live Similarweb estimates analyzed with Crusoe. Not seller-provided analytics.",
      target,
      comparison,
      ...(profiles.length > 1 ? { additionalProfiles: profiles.slice(1) } : {}),
      findings,
      summary,
      sellerQuestions: [...new Set(findings.map((finding) => finding.verificationQuestion))],
      limitations: [
        "Similarweb traffic is modeled third-party data, not proof of visits, revenue, customers, or misconduct.",
        "Small websites may have limited or less reliable estimates. Compare findings with GA4, payment, and customer records.",
        "This is a screening aid, not financial, legal, or investment advice.",
      ],
    });
    const saved = {
      id,
      accountId: owner,
      requestId,
      targetDomain,
      comparisonDomains,
      report,
      units,
      periodStart: reservation.periodStart,
    };
    await db.transaction(async (tx) => {
      await tx.insert(savedScreens).values(saved);
      const [completed] = await tx.update(requestIdempotency).set({
        status: "complete",
        resourceId: id,
        response: makeCachedResponse(report as unknown as Record<string, unknown>, fingerprint),
      }).where(and(
        eq(requestIdempotency.accountId, owner),
        eq(requestIdempotency.requestId, requestId),
        eq(requestIdempotency.requestType, "screens"),
        eq(requestIdempotency.status, "pending"),
        eq(requestIdempotency.resourceId, reservation.reservationId),
      )).returning({ requestId: requestIdempotency.requestId });
      if (!completed) throw new ReservationLeaseLostError("The screen reservation lease was replaced.");
    });
    persisted = true;
    res.json(report);
  } catch (error) {
    if (!persisted) {
      await refundReservation(owner, "screens", units, reservation.periodStart, requestId, reservation.reservationId).catch((refundError) => {
        req.log.error({ err: refundError }, "Failed to refund screen reservation");
      });
    }
    if (error instanceof ReservationLeaseLostError) {
      res.status(409).json({ error: "The screen reservation expired; retry using the same requestId." });
      return;
    }
    if (error instanceof ProviderError) {
      req.log.warn({ provider: error.provider, message: error.message }, "Screen provider failed");
      res.status(502).json({ error: `${error.provider}: ${error.message}` });
      return;
    }
    req.log.error({ err: error }, "Screen failed");
    res.status(500).json({ error: "Could not complete the screen." });
  }
});

router.get("/screens", async (_req, res) => {
  const records = await db.select().from(savedScreens)
    .where(eq(savedScreens.accountId, accountId(res)))
    .orderBy(desc(savedScreens.createdAt));
  res.json(records.map((record) => ({
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    targetDomain: record.targetDomain,
    comparisonDomains: record.comparisonDomains,
    report: record.report,
  })));
});

router.get("/screens/:id", async (req, res): Promise<void> => {
  const [record] = await db.select().from(savedScreens).where(and(
    eq(savedScreens.id, req.params.id),
    eq(savedScreens.accountId, accountId(res)),
  )).limit(1);
  if (!record) {
    res.status(404).json({ error: "Screen not found." });
    return;
  }
  res.json({
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    targetDomain: record.targetDomain,
    comparisonDomains: record.comparisonDomains,
    report: record.report,
  });
});

router.delete("/screens/:id", async (req, res): Promise<void> => {
  const [deleted] = await db.delete(savedScreens).where(and(
    eq(savedScreens.id, req.params.id),
    eq(savedScreens.accountId, accountId(res)),
  )).returning({ id: savedScreens.id });
  if (!deleted) {
    res.status(404).json({ error: "Screen not found." });
    return;
  }
  res.status(204).end();
});

export default router;