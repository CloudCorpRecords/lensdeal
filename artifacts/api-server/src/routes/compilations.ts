import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { CreateCompilationBody } from "@workspace/api-zod";
import { compilations, db, savedScreens } from "@workspace/db";
import { accountId, requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use(requireAuth);

function savedScreenView(record: typeof savedScreens.$inferSelect) {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    targetDomain: record.targetDomain,
    comparisonDomains: record.comparisonDomains,
    report: record.report,
  };
}

function summarizeScreens(screens: Array<typeof savedScreens.$inferSelect>): string {
  const evidence = screens.flatMap((screen) => {
    const report = screen.report as {
      summary?: string;
      findings?: Array<{ title?: string; value?: string; source?: string; sourceUrl?: string; period?: string }>;
    };
    return [
      `${screen.targetDomain} compared with ${screen.comparisonDomains.join(", ")}: ${report.summary || "No summary saved."}`,
      ...(report.findings || []).slice(0, 8).map((finding) =>
        `${finding.title || "Finding"} — ${finding.value || "No value"}; ${finding.source || "source not specified"}; ${finding.period || "period not specified"}; ${finding.sourceUrl || "source URL unavailable"}`,
      ),
    ];
  });
  return `Cross-screen summary based only on saved reports. Sources and periods are preserved in each evidence line:\n${evidence.join("\n").slice(0, 12000)}`;
}

router.get("/compilations", async (_req, res) => {
  const rows = await db.select().from(compilations).where(eq(compilations.accountId, accountId(res)))
    .orderBy(desc(compilations.createdAt));
  res.json(rows.map((row) => ({
    id: row.id,
    title: row.title,
    screenIds: row.screenIds,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
  })));
});

router.post("/compilations", async (req, res): Promise<void> => {
  const parsed = CreateCompilationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A title and at least one saved screen are required." });
    return;
  }
  const owner = accountId(res);
  const screenIds = [...new Set(parsed.data.screenIds)];
  const screens = await db.select().from(savedScreens).where(and(
    eq(savedScreens.accountId, owner),
    inArray(savedScreens.id, screenIds),
  ));
  if (screens.length !== screenIds.length) {
    res.status(400).json({ error: "Every selected screen must belong to your account." });
    return;
  }
  const id = randomUUID();
  const [created] = await db.insert(compilations).values({
    id,
    accountId: owner,
    title: parsed.data.title.trim(),
    screenIds,
    summary: summarizeScreens(screens),
  }).returning();
  res.status(201).json({
    id: created.id,
    title: created.title,
    screenIds: created.screenIds,
    summary: created.summary,
    createdAt: created.createdAt.toISOString(),
  });
});

router.get("/compilations/:id", async (req, res): Promise<void> => {
  const owner = accountId(res);
  const [record] = await db.select().from(compilations).where(and(
    eq(compilations.id, req.params.id),
    eq(compilations.accountId, owner),
  )).limit(1);
  if (!record) {
    res.status(404).json({ error: "Compilation not found." });
    return;
  }
  const screens = record.screenIds.length
    ? await db.select().from(savedScreens).where(and(
      eq(savedScreens.accountId, owner),
      inArray(savedScreens.id, record.screenIds),
    ))
    : [];
  const byId = new Map(screens.map((screen) => [screen.id, screen]));
  res.json({
    id: record.id,
    title: record.title,
    screenIds: record.screenIds,
    summary: record.summary,
    createdAt: record.createdAt.toISOString(),
    screens: record.screenIds.flatMap((id) => {
      const screen = byId.get(id);
      return screen ? [savedScreenView(screen)] : [];
    }),
  });
});

router.delete("/compilations/:id", async (req, res): Promise<void> => {
  const [deleted] = await db.delete(compilations).where(and(
    eq(compilations.id, req.params.id),
    eq(compilations.accountId, accountId(res)),
  )).returning({ id: compilations.id });
  if (!deleted) {
    res.status(404).json({ error: "Compilation not found." });
    return;
  }
  res.status(204).end();
});

export default router;