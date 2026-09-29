import { and, eq, sql } from "drizzle-orm";
import { accounts, db, processedStripeEvents } from "@workspace/db";
import type Stripe from "stripe";
import { getStripeSync } from "./stripeClient";

type Tier = "pro" | "team" | "enterprise";

function configuredPriceTier(priceId: string): Tier | null {
  for (const tier of ["pro", "team", "enterprise"] as const) {
    if (process.env[`STRIPE_APPROVED_TEST_PRICE_ID_${tier.toUpperCase()}`]?.trim() === priceId) return tier;
  }
  return null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}

async function retrieveAllSubscriptions(stripe: Stripe, customerId: string): Promise<Stripe.Subscription[]> {
  const subscriptions: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const result = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    subscriptions.push(...result.data);
    if (!result.has_more) return subscriptions;
    const lastId = result.data.at(-1)?.id;
    if (!lastId) throw new Error("Stripe returned an invalid subscription page.");
    startingAfter = lastId;
  }
  throw new Error("Customer has too many subscriptions to reconcile safely.");
}

async function invoiceIsCurrentlyPaid(
  stripe: Stripe,
  latestInvoice: Stripe.Subscription["latest_invoice"],
): Promise<boolean> {
  const invoiceId = idOf(latestInvoice);
  if (!invoiceId) return false;
  const invoice = typeof latestInvoice === "object" && latestInvoice !== null
    ? latestInvoice as Stripe.Invoice
    : await stripe.invoices.retrieve(invoiceId);
  return !invoice.livemode && invoice.status === "paid";
}

async function reconcileCustomerEntitlement(stripe: Stripe, customerId: string): Promise<void> {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return;
  const owner = customer.metadata.clerkUserId;
  if (!owner) return;

  await db.transaction(async (tx) => {
    // Serializing the live Stripe read and account update prevents two out-of-order
    // webhook requests from committing snapshots in the reverse order.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${owner}, 0))`);
    const subscriptions = await retrieveAllSubscriptions(stripe, customerId);
    const candidates: Array<{
      subscription: Stripe.Subscription;
      tier: Tier;
      periodStart: Date;
      periodEnd: Date;
    }> = [];

    for (const subscription of subscriptions) {
      if (subscription.livemode || subscription.status !== "active"
        || !(await invoiceIsCurrentlyPaid(stripe, subscription.latest_invoice))) continue;
      for (const item of subscription.items.data) {
        const tier = configuredPriceTier(item.price.id);
        if (!tier || !item.current_period_start || !item.current_period_end
          || item.current_period_end * 1000 <= Date.now()) continue;
        candidates.push({
          subscription,
          tier,
          periodStart: new Date(item.current_period_start * 1000),
          periodEnd: new Date(item.current_period_end * 1000),
        });
      }
    }

    const tierRank: Record<Tier, number> = { pro: 1, team: 2, enterprise: 3 };
    candidates.sort((a, b) =>
      tierRank[b.tier] - tierRank[a.tier]
      || b.periodEnd.getTime() - a.periodEnd.getTime()
      || b.subscription.created - a.subscription.created);
    const active = candidates[0];
    const values = {
      id: owner,
      tier: active?.tier ?? "free",
      subscriptionStatus: active ? "active" : "inactive",
      stripeCustomerId: customerId,
      stripeSubscriptionId: active?.subscription.id ?? null,
      periodStart: active?.periodStart ?? null,
      periodEnd: active?.periodEnd ?? null,
      updatedAt: new Date(),
    };
    await tx.insert(accounts).values(values).onConflictDoUpdate({
      target: accounts.id,
      set: {
        tier: values.tier,
        subscriptionStatus: values.subscriptionStatus,
        stripeCustomerId: values.stripeCustomerId,
        stripeSubscriptionId: values.stripeSubscriptionId,
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
        updatedAt: values.updatedAt,
      },
    });
  });
}

function customerIdForEvent(event: Stripe.Event): string | null {
  const object = event.data.object as { customer?: unknown };
  return idOf(object.customer);
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) throw new Error("Stripe webhook body is not a raw Buffer.");
    const stripeSync = await getStripeSync();
    await stripeSync.processWebhook(payload, signature);
    // StripeSync verifies the exact raw payload with its managed endpoint secret.
    const event = JSON.parse(payload.toString("utf8")) as Stripe.Event;
    if (event.livemode) throw new Error("Live-mode Stripe events are disabled pending billing approval.");

    const [claimed] = await db.insert(processedStripeEvents).values({
      id: event.id,
      success: false,
    }).onConflictDoNothing().returning({ id: processedStripeEvents.id });
    if (!claimed) {
      const [existing] = await db.select({ success: processedStripeEvents.success })
        .from(processedStripeEvents).where(eq(processedStripeEvents.id, event.id)).limit(1);
      if (existing?.success) return;
      // A process may have died after claiming this event. Reconciliation below
      // reads current Stripe state, so repeating it is safe and repairs the claim.
    }

    try {
      const isSubscriptionEvent = event.type.startsWith("customer.subscription.");
      const isInvoiceEvent = event.type === "invoice.paid" || event.type === "invoice.payment_failed";
      if (isSubscriptionEvent || isInvoiceEvent) {
        const customerId = customerIdForEvent(event);
        if (customerId) await reconcileCustomerEntitlement(stripeSync.stripe, customerId);
      }
      await db.update(processedStripeEvents).set({ success: true }).where(eq(processedStripeEvents.id, event.id));
    } catch (error) {
      await db.delete(processedStripeEvents).where(and(
        eq(processedStripeEvents.id, event.id),
        eq(processedStripeEvents.success, false),
      ));
      throw error;
    }
  }
}