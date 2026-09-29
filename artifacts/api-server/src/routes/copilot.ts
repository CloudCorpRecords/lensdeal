import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { AskCopilotBody } from "@workspace/api-zod";
import { compilations, copilotAnswers, db, requestIdempotency, savedScreens } from "@workspace/db";
import { accountId, requireAuth } from "../middlewares/requireAuth";
import { asksForBusinessPerformance, chooseCopilotPlan, currentLookupPolicy, EvidenceError, prepareCopilotEvidence, renderCopilotAnswer } from "../lib/copilot";
import { fetchFreshTrafficEstimate, ProviderError } from "../lib/screener";
import { fingerprintRequest, makeCachedResponse, refundReservation, ReservationLeaseLostError, reserveUsage } from "../lib/usage";

const router: IRouter = Router();
router.use(requireAuth);

function view(row: typeof copilotAnswers.$inferSelect) {
  return {
    id: row.id, compilationId: row.compilationId, question: row.question,
    answer: row.answer, freshLookup: row.freshLookup, citations: row.citations,
    createdAt: row.createdAt.toISOString(),
  };
}

async function ownedCompilation(id: string, owner: string) {
  const [record] = await db.select().from(compilations)
    .where(and(eq(compilations.id, id), eq(compilations.accountId, owner))).limit(1);
  return record;
}

router.get("/compilations/:id/copilot", async (req, res): Promise<void> => {
  const owner = accountId(res);
  if (!await ownedCompilation(req.params.id, owner)) {
    res.status(404).json({ error: "Compilation not found." });
    return;
  }
  const rows = await db.select().from(copilotAnswers).where(and(
    eq(copilotAnswers.accountId, owner), eq(copilotAnswers.compilationId, req.params.id),
  )).orderBy(asc(copilotAnswers.createdAt));
  res.json(rows.map(view));
});

router.post("/compilations/:id/copilot", async (req, res): Promise<void> => {
  const parsed = AskCopilotBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.question.trim()) {
    res.status(400).json({ error: "Provide a buyer question between 5 and 800 characters and a request ID." });
    return;
  }
  const owner = accountId(res);
  const compilation = await ownedCompilation(req.params.id, owner);
  if (!compilation) {
    res.status(404).json({ error: "Compilation not found." });
    return;
  }
  if (compilation.screenIds.length < 1 || compilation.screenIds.length > 6) {
    res.status(422).json({ error: "Choose a compilation of 1 to 6 reports for one bounded research question." });
    return;
  }
  const screens = await db.select({ id: savedScreens.id, report: savedScreens.report }).from(savedScreens).where(and(
    eq(savedScreens.accountId, owner), inArray(savedScreens.id, compilation.screenIds),
  ));
  if (screens.length !== compilation.screenIds.length) {
    res.status(404).json({ error: "A source report is no longer available. Create a new compilation." });
    return;
  }
  let evidence: ReturnType<typeof prepareCopilotEvidence>;
  let lookupPolicy: ReturnType<typeof currentLookupPolicy>;
  try {
    const byId = new Map(screens.map((screen) => [screen.id, screen]));
    evidence = prepareCopilotEvidence(compilation.screenIds.map((id) => byId.get(id)!));
    lookupPolicy = currentLookupPolicy(parsed.data.question, compilation.screenIds.map((id) => byId.get(id)!));
  } catch (error) {
    res.status(422).json({ error: error instanceof EvidenceError ? error.message : "Saved reports lack usable evidence." });
    return;
  }
  const question = parsed.data.question.trim();
  const requestId = parsed.data.requestId;
  const fingerprint = fingerprintRequest({ compilationId: compilation.id, question });
  const reservation = await reserveUsage(owner, "ai", 1, requestId, fingerprint);
  if (reservation.conflict) {
    res.status(409).json({ error: "This request ID was used for a different question." });
    return;
  }
  if (!reservation.ok) {
    res.status(reservation.pending ? 409 : 429).json({
      error: reservation.pending ? "This question is already being processed. Retry with the same request ID shortly."
        : `AI question limit reached (${reservation.used ?? 0}/${reservation.limit ?? 10}).`,
    });
    return;
  }
  if (reservation.duplicate && reservation.cachedResponse) {
    const cached = reservation.cachedResponse;
    if (cached.compilationId !== compilation.id || cached.question !== question) {
      res.status(409).json({ error: "This request ID belongs to a different AI request." });
      return;
    }
    res.json(cached);
    return;
  }
  let persisted = false;
  try {
    const modelPlan = await chooseCopilotPlan(question, evidence);
    const proposedPlan = asksForBusinessPerformance(question)
      ? { ...modelPlan, useFresh: false, targetReportId: null }
      : lookupPolicy.explicit
        ? { ...modelPlan, useFresh: lookupPolicy.needsLookup, targetReportId: lookupPolicy.needsLookup ? lookupPolicy.targetReportId : null }
        : modelPlan;
    // The model may ask for this narrow lookup; the server decides whether to permit it.
    const needsCurrent = /\b(latest|current|now|newest|up.to.date|since|more recent|this month|last month)\b/i.test(question);
    if (proposedPlan.useFresh && !needsCurrent) {
      throw new ProviderError("Crusoe", "The planner requested a fresh lookup unrelated to the buyer's question.");
    }
    const selected = screens.find((screen) => screen.id === proposedPlan.targetReportId);
    const domain = selected && (selected.report.target as { domain?: unknown } | undefined)?.domain;
    if (proposedPlan.useFresh && typeof domain !== "string") {
      throw new ProviderError("Crusoe", "The requested target has no usable domain.");
    }
    const plan = proposedPlan.useFresh && selected && typeof domain === "string"
      && !currentLookupPolicy(`latest ${domain}`, [selected]).needsLookup
      ? { ...proposedPlan, useFresh: false, targetReportId: null }
      : proposedPlan;
    const fresh = plan.useFresh && typeof domain === "string"
      ? await fetchFreshTrafficEstimate(domain)
      : undefined;
    const result = renderCopilotAnswer(evidence, plan, fresh, question);
    const id = randomUUID();
    const createdAt = new Date();
    const response = { id, compilationId: compilation.id, question, ...result, createdAt: createdAt.toISOString() };
    await db.transaction(async (tx) => {
      await tx.insert(copilotAnswers).values({ ...response, accountId: owner, requestId, createdAt });
      const [completed] = await tx.update(requestIdempotency).set({
        status: "complete", resourceId: id, response: makeCachedResponse(response, fingerprint),
      }).where(and(
        eq(requestIdempotency.accountId, owner),
        eq(requestIdempotency.requestId, requestId),
        eq(requestIdempotency.requestType, "ai"),
        eq(requestIdempotency.status, "pending"),
        eq(requestIdempotency.resourceId, reservation.reservationId),
      )).returning({ requestId: requestIdempotency.requestId });
      if (!completed) throw new ReservationLeaseLostError("The AI request lease was replaced.");
    });
    persisted = true;
    res.json(response);
  } catch (error) {
    if (!persisted) {
      await refundReservation(owner, "ai", 1, reservation.periodStart, requestId, reservation.reservationId).catch((refundError) => {
        req.log.error({ err: refundError }, "Failed to refund copilot request");
      });
    }
    if (error instanceof ReservationLeaseLostError) {
      res.status(409).json({ error: "The request expired; retry with the same request ID." });
    } else if (error instanceof ProviderError) {
      req.log.warn({ provider: error.provider, message: error.message }, "Copilot provider failed");
      res.status(502).json({ error: `${error.provider}: ${error.message}` });
    } else {
      req.log.error({ err: error }, "Copilot question failed");
      res.status(500).json({ error: "Could not create a grounded answer. Your AI question was not charged." });
    }
  }
});

export default router;