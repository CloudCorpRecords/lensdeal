import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { CreateExplanationBody } from "@workspace/api-zod";
import { db, explanations, requestIdempotency, savedScreens } from "@workspace/db";
import { accountId, requireAuth } from "../middlewares/requireAuth";
import { generateExplanation, type Citation } from "../lib/explanations";
import { fetchFreshTrafficEstimate, ProviderError } from "../lib/screener";
import {
  fingerprintRequest,
  makeCachedResponse,
  refundReservation,
  ReservationLeaseLostError,
  reserveUsage,
} from "../lib/usage";

const router: IRouter = Router();
router.use(requireAuth);

function citationsFrom(reportValue: Record<string, unknown>): Citation[] {
  const findings = Array.isArray(reportValue.findings) ? reportValue.findings as Array<Record<string, unknown>> : [];
  const generatedAt = typeof reportValue.generatedAt === "string" ? reportValue.generatedAt : new Date().toISOString();
  const citations = new Map<string, Citation>();
  for (const finding of findings) {
    const url = finding.sourceUrl;
    if (typeof url !== "string") continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") continue;
    } catch {
      continue;
    }
    const label = typeof finding.source === "string" ? finding.source : "Saved screen source";
    const period = typeof finding.period === "string" ? finding.period : String(reportValue.period || "Saved report period");
    citations.set(`${label}|${url}|${period}`, { label, url, period, retrievedAt: generatedAt });
  }
  return [...citations.values()].slice(0, 12);
}

router.post("/explanations", async (req, res): Promise<void> => {
  const parsed = CreateExplanationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide a saved screen and a question between 5 and 800 characters." });
    return;
  }
  if (!parsed.data.requestId) {
    res.status(400).json({ error: "requestId is required for idempotent AI questions." });
    return;
  }
  const owner = accountId(res);
  const [screen] = await db.select().from(savedScreens).where(and(
    eq(savedScreens.id, parsed.data.screenId),
    eq(savedScreens.accountId, owner),
  )).limit(1);
  if (!screen) {
    res.status(404).json({ error: "Saved screen not found." });
    return;
  }
  const report = screen.report;
  const citations = citationsFrom(report);
  if (!citations.length) {
    res.status(422).json({ error: "This saved screen has no usable citations, so it cannot be explained safely." });
    return;
  }
  const requestId = parsed.data.requestId;
  const fingerprint = fingerprintRequest({ screenId: parsed.data.screenId, question: parsed.data.question });
  const reservation = await reserveUsage(owner, "ai", 1, requestId, fingerprint);
  if (reservation.conflict) {
    res.status(409).json({ error: "This requestId was already used for a different AI question." });
    return;
  }
  if (!reservation.ok) {
    res.status(reservation.pending ? 409 : 429).json({
      error: reservation.pending ? "A request with this requestId is already being processed."
        : `AI question limit reached (${reservation.used ?? 0}/${reservation.limit ?? 10}).`,
    });
    return;
  }
  if (reservation.duplicate && reservation.cachedResponse) {
    if (reservation.cachedResponse.screenId !== parsed.data.screenId
      || reservation.cachedResponse.question !== parsed.data.question) {
      res.status(409).json({ error: "This requestId was already used for a different AI question." });
      return;
    }
    res.json(reservation.cachedResponse);
    return;
  }

  let persisted = false;
  try {
    const freshEstimate = await fetchFreshTrafficEstimate(screen.targetDomain);
    const allCitations = [
      ...citations,
      {
        label: freshEstimate.source,
        url: freshEstimate.sourceUrl,
        period: freshEstimate.period,
        retrievedAt: freshEstimate.retrievedAt,
      },
    ];
    const answer = await generateExplanation(parsed.data.question, report, allCitations, freshEstimate);
    const id = randomUUID();
    const createdAt = new Date();
    const response = {
      id,
      screenId: screen.id,
      question: parsed.data.question,
      answer,
      citations: allCitations,
      createdAt: createdAt.toISOString(),
    };
    await db.transaction(async (tx) => {
      await tx.insert(explanations).values({
        id,
        accountId: owner,
        screenId: screen.id,
        requestId,
        question: parsed.data.question,
        answer,
        citations: allCitations,
        createdAt,
      });
      const [completed] = await tx.update(requestIdempotency).set({
        status: "complete",
        resourceId: id,
        response: makeCachedResponse(response, fingerprint),
      }).where(and(
        eq(requestIdempotency.accountId, owner),
        eq(requestIdempotency.requestId, requestId),
        eq(requestIdempotency.requestType, "ai"),
        eq(requestIdempotency.status, "pending"),
        eq(requestIdempotency.resourceId, reservation.reservationId),
      )).returning({ requestId: requestIdempotency.requestId });
      if (!completed) throw new ReservationLeaseLostError("The AI request reservation lease was replaced.");
    });
    persisted = true;
    res.json(response);
  } catch (error) {
    if (!persisted) {
      await refundReservation(owner, "ai", 1, reservation.periodStart, requestId, reservation.reservationId).catch((refundError) => {
        req.log.error({ err: refundError }, "Failed to refund AI reservation");
      });
    }
    if (error instanceof ReservationLeaseLostError) {
      res.status(409).json({ error: "The AI reservation expired; retry using the same requestId." });
      return;
    }
    if (error instanceof ProviderError) {
      req.log.warn({ provider: error.provider, message: error.message }, "Explanation provider failed");
      res.status(502).json({ error: `${error.provider}: ${error.message}` });
      return;
    }
    req.log.error({ err: error }, "Explanation failed");
    res.status(500).json({ error: "Could not create an evidence-grounded answer." });
  }
});

router.get("/screens/:id/explanations", async (req, res): Promise<void> => {
  const owner = accountId(res);
  const [screen] = await db.select({ id: savedScreens.id }).from(savedScreens).where(and(
    eq(savedScreens.id, req.params.id),
    eq(savedScreens.accountId, owner),
  )).limit(1);
  if (!screen) {
    res.status(404).json({ error: "Saved screen not found." });
    return;
  }
  const rows = await db.select().from(explanations).where(and(
    eq(explanations.screenId, screen.id),
    eq(explanations.accountId, owner),
  )).orderBy(asc(explanations.createdAt));
  res.json(rows.map((row) => ({
    id: row.id,
    screenId: row.screenId,
    question: row.question,
    answer: row.answer,
    citations: row.citations,
    createdAt: row.createdAt.toISOString(),
  })));
});

export default router;