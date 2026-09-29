import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { accounts, db, processedStripeEvents } from "@workspace/db";
import { logger } from "./logger";
import {
  approvedTestPrices,
  billingMode,
  expectedLiveMode,
  isStripePeriodicReconciliationReady,
  setStripePeriodicReconciliationReady,
} from "./billingState";
import { requireTestBillingMode, stripeGet, type StripeObject } from "./stripeClient";
import { verifyApprovedTestPrice, type BillingTier } from "./stripeValidation";
import { getStripeWebhookSecret } from "./stripeWebhookSecrets";
import { verifyStripeSignature } from "./stripeWebhookSignature";
import { canReconcileBillingAccount } from "./billingOwnership";

type StripeEvent = {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: StripeObject };
};

function asRecord(value: unknown): StripeObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as StripeObject
    : null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  const object = asRecord(value);
  return typeof object?.id === "string" ? object.id : null;
}

function priceTier(priceId: string): BillingTier | null {
  for (const tier of ["pro", "team", "enterprise"] as const) {
    if (approvedTestPrices()[tier] === priceId) return tier;
  }
  return null;
}

function requireTestObject(object: StripeObject | null, kind: string): StripeObject {
  if (!object || object.livemode !== expectedLiveMode()) {
    throw new Error(`Stripe ${kind} belongs to the wrong billing environment.`);
  }
  return object;
}

function rejectWrongEventObjects(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectWrongEventObjects);
    return;
  }
  const object = asRecord(value);
  if (!object) return;
  if (typeof object.livemode === "boolean" && object.livemode !== expectedLiveMode()) {
    throw new Error("Stripe event object belongs to the wrong billing environment.");
  }
  Object.values(object).forEach(rejectWrongEventObjects);
}

async function fetchAllSubscriptions(customerId: string): Promise<StripeObject[]> {
  const subscriptions: StripeObject[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({
      customer: customerId,
      status: "all",
      limit: "100",
    });
    if (startingAfter) params.set("starting_after", startingAfter);
    const result = await stripeGet(`/v1/subscriptions?${params.toString()}`);
    if (!Array.isArray(result.data)) throw new Error("Stripe returned an invalid subscriptions page.");
    subscriptions.push(...result.data.map((value) => requireTestObject(asRecord(value), "subscription")));
    if (result.has_more !== true) return subscriptions;
    const lastId = idOf(result.data.at(-1));
    if (!lastId) throw new Error("Stripe returned an invalid subscriptions cursor.");
    startingAfter = lastId;
  }
  throw new Error("Customer has too many subscriptions to reconcile safely.");
}

async function latestInvoiceIsPaid(latestInvoice: unknown): Promise<boolean> {
  const invoiceId = idOf(latestInvoice);
  if (!invoiceId) return false;
  let invoice = asRecord(latestInvoice);
  if (!invoice || typeof invoice.status !== "string" || invoice.livemode !== false) {
    invoice = await stripeGet(`/v1/invoices/${encodeURIComponent(invoiceId)}`);
  }
  requireTestObject(invoice, "invoice");
  return invoice.status === "paid";
}

function accountPatch(owner: string, customerId: string, candidate?: {
  tier: BillingTier;
  subscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
}) {
  return {
    id: owner,
    tier: candidate?.tier ?? "free",
    subscriptionStatus: candidate ? "active" : "inactive",
    stripeCustomerId: customerId,
    stripeBillingMode: billingMode()!,
    stripeSubscriptionId: candidate?.subscriptionId ?? null,
    periodStart: candidate?.periodStart ?? null,
    periodEnd: candidate?.periodEnd ?? null,
    updatedAt: new Date(),
  };
}

async function persistEntitlement(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  owner: string,
  customerId: string,
  candidate?: {
  tier: BillingTier;
  subscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
  },
): Promise<void> {
  const values = accountPatch(owner, customerId, candidate);
  await tx.insert(accounts).values(values).onConflictDoUpdate({
    target: accounts.id,
    set: {
      tier: values.tier,
      subscriptionStatus: values.subscriptionStatus,
      stripeCustomerId: values.stripeCustomerId,
      stripeBillingMode: values.stripeBillingMode,
      stripeSubscriptionId: values.stripeSubscriptionId,
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      updatedAt: values.updatedAt,
    },
  });
}

export async function reconcileCustomerEntitlement(customerId: string): Promise<void> {
  requireTestBillingMode();
  const customer = requireTestObject(
    await stripeGet(`/v1/customers/${encodeURIComponent(customerId)}`),
    "customer",
  );
  const metadata = asRecord(customer.metadata);
  let owner = typeof metadata?.clerkUserId === "string" ? metadata.clerkUserId : null;
  if (!owner) {
    const [account] = await db.select({ id: accounts.id }).from(accounts)
      .where(and(eq(accounts.stripeCustomerId, customerId), eq(accounts.stripeBillingMode, billingMode()!))).limit(1);
    owner = account?.id ?? null;
  }
  if (!owner) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${owner}, 0))`);
    const [current] = await tx.select({
      stripeCustomerId: accounts.stripeCustomerId,
      stripeBillingMode: accounts.stripeBillingMode,
    }).from(accounts).where(eq(accounts.id, owner)).for("update").limit(1);
    if (!canReconcileBillingAccount(current, billingMode()!, customerId)) return;
    const deleted = customer.deleted === true;
    const candidateSubscriptions = deleted ? [] : await fetchAllSubscriptions(customerId);
    const candidates: Array<{
      tier: BillingTier;
      subscriptionId: string;
      periodStart: Date;
      periodEnd: Date;
      created: number;
    }> = [];

    for (const subscription of candidateSubscriptions) {
      if (subscription.status !== "active" || !(await latestInvoiceIsPaid(subscription.latest_invoice))) continue;
      const items = asRecord(subscription.items);
      const itemData = items?.data;
      if (!Array.isArray(itemData)) continue;
      for (const itemValue of itemData) {
        const item = asRecord(itemValue);
        const price = asRecord(item?.price);
        if (!item || !price || price.livemode !== expectedLiveMode() || typeof price.id !== "string") continue;
        const tier = priceTier(price.id);
        if (!tier) continue;
        await verifyApprovedTestPrice(tier, price.id);
        const periodStartSeconds = item.current_period_start ?? subscription.current_period_start;
        const periodEndSeconds = item.current_period_end ?? subscription.current_period_end;
        if (typeof periodStartSeconds !== "number" || typeof periodEndSeconds !== "number"
          || periodEndSeconds * 1000 <= Date.now()) continue;
        candidates.push({
          tier,
          subscriptionId: String(subscription.id),
          periodStart: new Date(periodStartSeconds * 1000),
          periodEnd: new Date(periodEndSeconds * 1000),
          created: typeof subscription.created === "number" ? subscription.created : 0,
        });
      }
    }

    const tierRank: Record<BillingTier, number> = { pro: 1, team: 2, enterprise: 3 };
    candidates.sort((a, b) =>
      tierRank[b.tier] - tierRank[a.tier]
      || b.periodEnd.getTime() - a.periodEnd.getTime()
      || b.created - a.created);
    await persistEntitlement(tx, owner!, customerId, candidates[0]);
  });
}

async function reconcileAllCustomers(): Promise<void> {
  let afterId: string | undefined;
  while (true) {
    const conditions = afterId
      ? and(isNotNull(accounts.stripeCustomerId), eq(accounts.stripeBillingMode, billingMode()!), gt(accounts.id, afterId))
      : and(isNotNull(accounts.stripeCustomerId), eq(accounts.stripeBillingMode, billingMode()!));
    const rows = await db.select({ accountId: accounts.id, customerId: accounts.stripeCustomerId })
      .from(accounts)
      .where(conditions)
      .orderBy(asc(accounts.id))
      .limit(100);
    if (rows.length === 0) return;
    for (const row of rows) {
      afterId = row.accountId;
      if (row.customerId) await reconcileCustomerEntitlement(row.customerId);
    }
    if (rows.length < 100) return;
  }
}

let periodicStarted = false;
let periodicRun: Promise<void> | null = null;

async function runPeriodicReconciliation(): Promise<void> {
  if (periodicRun) return periodicRun;
  periodicRun = (async () => {
    try {
      await reconcileAllCustomers();
      setStripePeriodicReconciliationReady(true);
    } catch {
      setStripePeriodicReconciliationReady(false);
      logger.warn("Periodic Stripe entitlement reconciliation failed.");
    } finally {
      periodicRun = null;
    }
  })();
  return periodicRun;
}

export async function startPeriodicStripeReconciliation(): Promise<boolean> {
  requireTestBillingMode();
  await runPeriodicReconciliation();
  if (!periodicStarted) {
    periodicStarted = true;
    const interval = setInterval(() => {
      void runPeriodicReconciliation();
    }, 5 * 60 * 1000);
    interval.unref();
  }
  return isStripePeriodicReconciliationReady();
}

function customerIdForEvent(event: StripeEvent): string | null {
  return idOf(event.data.object.customer);
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    requireTestBillingMode();
    if (!Buffer.isBuffer(payload)) throw new Error("Stripe webhook body is not a raw Buffer.");
    const stored = await getStripeWebhookSecret();
    if (!stored) throw new Error("A verified Stripe webhook endpoint is not configured.");
    if (!verifyStripeSignature(payload, signature, stored.secret)) {
      throw new Error("Stripe webhook signature verification failed.");
    }

    const event = JSON.parse(payload.toString("utf8")) as StripeEvent;
    if (!event || typeof event.id !== "string" || typeof event.type !== "string"
      || !event.data || !asRecord(event.data.object)) {
      throw new Error("Stripe webhook payload is invalid.");
    }
    if (event.livemode !== expectedLiveMode()) throw new Error("Stripe event belongs to the wrong billing environment.");
    rejectWrongEventObjects(event);
    const eventKey = `${billingMode()}:${event.id}`;

    const [claimed] = await db.insert(processedStripeEvents).values({
      id: eventKey,
      success: false,
    }).onConflictDoNothing().returning({ id: processedStripeEvents.id });
    if (!claimed) {
      const [existing] = await db.select({ success: processedStripeEvents.success })
        .from(processedStripeEvents).where(eq(processedStripeEvents.id, eventKey)).limit(1);
      if (existing?.success) return;
      throw new Error("Stripe event is already being processed; retry later.");
    }

    try {
      const isSubscriptionEvent = event.type.startsWith("customer.subscription.");
      const isInvoiceEvent = event.type === "invoice.paid" || event.type === "invoice.payment_failed";
      if (isSubscriptionEvent || isInvoiceEvent) {
        const customerId = customerIdForEvent(event);
        if (customerId) await reconcileCustomerEntitlement(customerId);
      }
      await db.update(processedStripeEvents).set({ success: true })
        .where(eq(processedStripeEvents.id, eventKey));
    } catch (error) {
      await db.delete(processedStripeEvents).where(and(
        eq(processedStripeEvents.id, eventKey),
        eq(processedStripeEvents.success, false),
      ));
      throw error;
    }
  }
}