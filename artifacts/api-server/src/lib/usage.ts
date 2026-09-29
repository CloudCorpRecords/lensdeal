import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  accounts,
  db,
  explanations,
  requestIdempotency,
  savedScreens,
  usageCounters,
} from "@workspace/db";
import { billingMode } from "./billingState";

export type UsageKind = "screens" | "ai";
export type Tier = "free" | "pro" | "team" | "enterprise";

export class ReservationLeaseLostError extends Error {}

const limits: Record<Tier, { screens: number; ai: number }> = {
  free: { screens: 10, ai: 10 },
  pro: { screens: 50, ai: 100 },
  team: { screens: 250, ai: 500 },
  enterprise: { screens: 1000, ai: 2000 },
};
const RESERVATION_LEASE_MS = 10 * 60 * 1000;
const ENVELOPE_KEY = "__deallens_idempotency";

type RequestEnvelope = {
  version: 1;
  fingerprint: string;
  leaseExpiresAt: string;
  response?: Record<string, unknown>;
  units: number;
  periodStart: string;
  reservationId: string;
};

export function fingerprintRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function makeCachedResponse(response: Record<string, unknown>, fingerprint: string): Record<string, unknown> {
  return {
    [ENVELOPE_KEY]: {
      version: 1,
      fingerprint,
      response,
    },
  };
}

function readEnvelope(value: unknown): Partial<RequestEnvelope> | null {
  if (!value || typeof value !== "object" || !(ENVELOPE_KEY in value)) return null;
  const envelope = (value as Record<string, unknown>)[ENVELOPE_KEY];
  return envelope && typeof envelope === "object" ? envelope as Partial<RequestEnvelope> : null;
}

function readCachedResponse(value: unknown): Record<string, unknown> | null {
  const envelope = readEnvelope(value);
  if (envelope?.response && typeof envelope.response === "object") return envelope.response;
  // Preserve compatibility with idempotency rows written before envelopes existed.
  return value && typeof value === "object" && !readEnvelope(value)
    ? value as Record<string, unknown>
    : null;
}

export function limitsFor(tier: string): { screens: number; ai: number } {
  return limits[(tier in limits ? tier : "free") as Tier];
}

export function utcCalendarPeriod(now = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export async function ensureAccount(accountId: string) {
  await db.insert(accounts).values({ id: accountId }).onConflictDoNothing();
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) throw new Error("Could not initialize the account.");
  return account;
}

export async function accountPeriod(accountId: string) {
  const account = await ensureAccount(accountId);
  const now = new Date();
  const paid = account.tier !== "free"
    && account.stripeBillingMode === billingMode()
    && account.subscriptionStatus === "active"
    && account.periodStart
    && account.periodEnd
    && account.periodEnd > now;
  const period = paid
    ? { start: account.periodStart!, end: account.periodEnd! }
    : utcCalendarPeriod(now);
  return { account, period, tier: paid ? account.tier as Tier : "free" as Tier };
}

export async function usageCount(accountId: string, periodStart: Date, kind: UsageKind): Promise<number> {
  const [usage] = await db.select({ used: usageCounters.used }).from(usageCounters).where(and(
    eq(usageCounters.accountId, accountId),
    eq(usageCounters.periodStart, periodStart),
    eq(usageCounters.kind, kind),
  )).limit(1);
  return usage?.used ?? 0;
}

export type Reservation = {
  ok: boolean;
  duplicate?: boolean;
  pending?: boolean;
  conflict?: boolean;
  cachedResponse?: Record<string, unknown>;
  resourceId?: string | null;
  used?: number;
  limit?: number;
  reservationId: string;
  periodStart: Date;
  periodEnd: Date;
};

function currentAccountPeriod(account: typeof accounts.$inferSelect, now: Date) {
  const paid = account.tier !== "free"
    && account.stripeBillingMode === billingMode()
    && account.subscriptionStatus === "active"
    && !!account.periodStart
    && !!account.periodEnd
    && account.periodEnd > now;
  return {
    period: paid
      ? { start: account.periodStart!, end: account.periodEnd! }
      : utcCalendarPeriod(now),
    tier: paid ? account.tier as Tier : "free" as Tier,
  };
}

async function reconcileSavedResult(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  accountId: string,
  kind: UsageKind,
  requestId: string,
): Promise<{ resourceId: string; response: Record<string, unknown> } | null> {
  if (kind === "screens") {
    const [screen] = await tx.select().from(savedScreens).where(and(
      eq(savedScreens.accountId, accountId),
      eq(savedScreens.requestId, requestId),
    )).limit(1);
    if (screen) {
      return {
        resourceId: screen.id,
        response: screen.report as Record<string, unknown>,
      };
    }
    return null;
  }
  const [explanation] = await tx.select().from(explanations).where(and(
    eq(explanations.accountId, accountId),
    eq(explanations.requestId, requestId),
  )).limit(1);
  if (!explanation) return null;
  return {
    resourceId: explanation.id,
    response: {
      id: explanation.id,
      screenId: explanation.screenId,
      question: explanation.question,
      answer: explanation.answer,
      citations: explanation.citations,
      createdAt: explanation.createdAt.toISOString(),
    },
  };
}

export async function reserveUsage(
  accountId: string,
  kind: UsageKind,
  units: number,
  requestId: string,
  fingerprint: string,
): Promise<Reservation> {
  const reservationId = randomUUID();
  return db.transaction(async (tx) => {
    await tx.insert(accounts).values({ id: accountId }).onConflictDoNothing();
    // Serialize quota and lease recovery per account, including across API replicas.
    const [account] = await tx.select().from(accounts)
      .where(eq(accounts.id, accountId)).for("update").limit(1);
    if (!account) throw new Error("Could not initialize the account.");
    const now = new Date();
    const { period, tier } = currentAccountPeriod(account, now);
    const limit = limitsFor(tier)[kind];
    let existing: typeof requestIdempotency.$inferSelect | undefined;

    if (requestId) {
      [existing] = await tx.select().from(requestIdempotency).where(and(
        eq(requestIdempotency.accountId, accountId),
        eq(requestIdempotency.requestId, requestId),
        eq(requestIdempotency.requestType, kind),
      )).for("update").limit(1);

      if (existing?.status === "complete" && existing.response) {
        const envelope = readEnvelope(existing.response);
        if (envelope?.fingerprint && envelope.fingerprint !== fingerprint) {
          return { ok: false, conflict: true, reservationId, periodStart: period.start, periodEnd: period.end };
        }
        const cachedResponse = readCachedResponse(existing.response);
        if (cachedResponse) {
          return {
            ok: true,
            duplicate: true,
            cachedResponse,
            resourceId: existing.resourceId,
            reservationId,
            periodStart: period.start,
            periodEnd: period.end,
          };
        }
      }

      if (existing?.status === "pending") {
        const envelope = readEnvelope(existing.response);
        if (envelope?.fingerprint && envelope.fingerprint !== fingerprint) {
          return { ok: false, conflict: true, reservationId, periodStart: period.start, periodEnd: period.end };
        }
        const leaseExpiresAt = envelope?.leaseExpiresAt ? new Date(envelope.leaseExpiresAt) : null;
        const leaseLive = leaseExpiresAt && !Number.isNaN(leaseExpiresAt.getTime())
          ? leaseExpiresAt.getTime() > now.getTime()
          : existing.createdAt.getTime() + RESERVATION_LEASE_MS > now.getTime();
        if (leaseLive) {
          return {
            ok: false,
            duplicate: true,
            pending: true,
            reservationId,
            periodStart: period.start,
            periodEnd: period.end,
          };
        }

        const savedResult = await reconcileSavedResult(tx, accountId, kind, requestId);
        if (savedResult) {
          const savedFingerprint = envelope?.fingerprint || fingerprint;
          await tx.update(requestIdempotency).set({
            status: "complete",
            resourceId: savedResult.resourceId,
            response: makeCachedResponse(savedResult.response, savedFingerprint),
          }).where(and(
            eq(requestIdempotency.accountId, accountId),
            eq(requestIdempotency.requestId, requestId),
            eq(requestIdempotency.requestType, kind),
          ));
          return {
            ok: true,
            duplicate: true,
            cachedResponse: savedResult.response,
            resourceId: savedResult.resourceId,
            reservationId,
            periodStart: period.start,
            periodEnd: period.end,
          };
        }

        const oldPeriodStart = envelope?.periodStart ? new Date(envelope.periodStart) : null;
        const oldUnits = Number.isSafeInteger(envelope?.units) && Number(envelope?.units) > 0
          ? Number(envelope?.units)
          : 0;
        if (oldPeriodStart && !Number.isNaN(oldPeriodStart.getTime()) && oldUnits) {
          await tx.update(usageCounters).set({
            used: sql`GREATEST(${usageCounters.used} - ${oldUnits}, 0)`,
            updatedAt: now,
          }).where(and(
            eq(usageCounters.accountId, accountId),
            eq(usageCounters.periodStart, oldPeriodStart),
            eq(usageCounters.kind, kind),
          ));
        }
        await tx.delete(requestIdempotency).where(and(
          eq(requestIdempotency.accountId, accountId),
          eq(requestIdempotency.requestId, requestId),
          eq(requestIdempotency.requestType, kind),
        ));
        existing = undefined;
      }
    }

    const [counter] = await tx.insert(usageCounters).values({
      accountId,
      periodStart: period.start,
      periodEnd: period.end,
      kind,
      used: units,
    }).onConflictDoUpdate({
      target: [usageCounters.accountId, usageCounters.periodStart, usageCounters.kind],
      set: {
        used: sql`${usageCounters.used} + ${units}`,
        periodEnd: period.end,
        updatedAt: now,
      },
      where: sql`${usageCounters.used} + ${units} <= ${limit}`,
    }).returning({ used: usageCounters.used });
    if (!counter) {
      const [current] = await tx.select({ used: usageCounters.used }).from(usageCounters).where(and(
        eq(usageCounters.accountId, accountId),
        eq(usageCounters.periodStart, period.start),
        eq(usageCounters.kind, kind),
      )).limit(1);
      return {
        ok: false,
        used: current?.used ?? 0,
        limit,
        reservationId,
        periodStart: period.start,
        periodEnd: period.end,
      };
    }

    if (requestId) {
      const lease: RequestEnvelope = {
        version: 1,
        fingerprint,
        leaseExpiresAt: new Date(now.getTime() + RESERVATION_LEASE_MS).toISOString(),
        units,
        periodStart: period.start.toISOString(),
        reservationId,
      };
      const pendingResponse = { [ENVELOPE_KEY]: lease };
      if (existing) {
        await tx.update(requestIdempotency).set({
          status: "pending",
          resourceId: reservationId,
          response: pendingResponse,
          createdAt: now,
        }).where(and(
          eq(requestIdempotency.accountId, accountId),
          eq(requestIdempotency.requestId, requestId),
          eq(requestIdempotency.requestType, kind),
        ));
      } else {
        await tx.insert(requestIdempotency).values({
          accountId,
          requestId,
          requestType: kind,
          status: "pending",
          resourceId: reservationId,
          response: pendingResponse,
          createdAt: now,
        });
      }
    }
    return {
      ok: true,
      used: counter.used,
      limit,
      reservationId,
      periodStart: period.start,
      periodEnd: period.end,
    };
  });
}

export async function refundReservation(
  accountId: string,
  kind: UsageKind,
  units: number,
  periodStart: Date,
  requestId: string,
  reservationId: string,
) {
  await db.transaction(async (tx) => {
    const [ownedLease] = await tx.select({ accountId: requestIdempotency.accountId }).from(requestIdempotency).where(and(
      eq(requestIdempotency.accountId, accountId),
      eq(requestIdempotency.requestId, requestId),
      eq(requestIdempotency.requestType, kind),
      eq(requestIdempotency.status, "pending"),
      eq(requestIdempotency.resourceId, reservationId),
    )).for("update").limit(1);
    if (!ownedLease) return;
    await tx.update(usageCounters).set({
      used: sql`GREATEST(${usageCounters.used} - ${units}, 0)`,
      updatedAt: new Date(),
    }).where(and(
      eq(usageCounters.accountId, accountId),
      eq(usageCounters.periodStart, periodStart),
      eq(usageCounters.kind, kind),
    ));
    await tx.delete(requestIdempotency).where(and(
      eq(requestIdempotency.accountId, accountId),
      eq(requestIdempotency.requestId, requestId),
      eq(requestIdempotency.requestType, kind),
      eq(requestIdempotency.resourceId, reservationId),
    ));
  });
}