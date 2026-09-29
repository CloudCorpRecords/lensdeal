import { Router, type IRouter } from "express";
import { CreateCheckoutBody } from "@workspace/api-zod";
import { accounts, db } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { accountId, requireAuth } from "../middlewares/requireAuth";
import { accountPeriod, limitsFor, usageCount } from "../lib/usage";
import { stripeGet, stripePost } from "../lib/stripeClient";
import {
  approvedTestPrices,
  billingMode,
  expectedLiveMode,
  getVerifiedTestPrice,
  isStripeBillingReady,
  isStripePeriodicReconciliationReady,
  isStripeWebhookReady,
  stripeWebhookStatusNote,
} from "../lib/billingState";
import { approvedBillingOrigin, billingReturnUrl } from "../lib/billingRedirect";
import { verifyApprovedTestPrice } from "../lib/stripeValidation";
import { createHash } from "node:crypto";
import { canStartCheckout } from "../lib/billingOwnership";

const router: IRouter = Router();
const tiers = ["pro", "team", "enterprise"] as const;

function approvedPrice(tier: (typeof tiers)[number]): string | undefined {
  return approvedTestPrices()[tier];
}

function configuredCheckout(tier: (typeof tiers)[number]): boolean {
  return isStripeBillingReady()
    && !!billingMode()
    && !!approvedPrice(tier);
}

router.get("/billing/plans", (_req, res) => {
  const proPrice = getVerifiedTestPrice("pro");
  const teamPrice = getVerifiedTestPrice("team");
  const enterprisePrice = getVerifiedTestPrice("enterprise");
  res.json({
    plans: [
      { tier: "free", name: "Free", monthlyPrice: 0, screenLimit: 10, aiLimit: 10, checkoutAvailable: false },
      { tier: "pro", name: "Pro", monthlyPrice: proPrice?.amountMinor ?? 0, currency: proPrice?.currency ?? null, monthlyPriceDisplay: proPrice?.display ?? null, screenLimit: 50, aiLimit: 100, checkoutAvailable: configuredCheckout("pro") },
      { tier: "team", name: "Team", monthlyPrice: teamPrice?.amountMinor ?? 0, currency: teamPrice?.currency ?? null, monthlyPriceDisplay: teamPrice?.display ?? null, screenLimit: 250, aiLimit: 500, checkoutAvailable: configuredCheckout("team") },
      { tier: "enterprise", name: "Enterprise", monthlyPrice: enterprisePrice?.amountMinor ?? 0, currency: enterprisePrice?.currency ?? null, monthlyPriceDisplay: enterprisePrice?.display ?? null, screenLimit: 1000, aiLimit: 2000, checkoutAvailable: configuredCheckout("enterprise") },
    ],
    billingStatus: {
      mode: billingMode() ?? "unavailable",
      enabled: isStripeBillingReady(),
      webhookVerified: isStripeWebhookReady(),
      periodicReconciliationVerified: isStripePeriodicReconciliationReady(),
      limitation: stripeWebhookStatusNote(),
    },
    note: `For verified prices, monthlyPrice is the integer amount in cents. A price of 0 with no display means the price could not be verified. ${billingMode() === "live" ? "Live checkout charges real money when billing is ready." : "This preview uses test-mode Stripe; no live charge will be made."}`,
  });
});

router.use(requireAuth);

router.get("/account", async (_req, res) => {
  const owner = accountId(res);
  const { period, tier } = await accountPeriod(owner);
  const [screensUsed, aiUsed, accountRows] = await Promise.all([
    usageCount(owner, period.start, "screens"),
    usageCount(owner, period.start, "ai"),
    db.select({ stripeCustomerId: accounts.stripeCustomerId, stripeBillingMode: accounts.stripeBillingMode }).from(accounts).where(eq(accounts.id, owner)).limit(1),
  ]);
  const limits = limitsFor(tier);
  res.json({
    tier,
    screensUsed,
    screenLimit: limits.screens,
    aiUsed,
    aiLimit: limits.ai,
    resetsAt: period.end.toISOString(),
    billingEnabled: tiers.some(configuredCheckout),
    billingMode: billingMode() ?? "unavailable",
    hasBillingCustomer: accountRows[0]?.stripeBillingMode === billingMode() && !!accountRows[0]?.stripeCustomerId,
  });
});

router.post("/billing/checkout", async (req, res): Promise<void> => {
  const parsed = CreateCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid subscription tier." });
    return;
  }
  const tier = parsed.data.tier;
  const priceId = approvedPrice(tier);
  if (!configuredCheckout(tier) || !priceId) {
    res.status(503).json({ error: "Checkout is unavailable until the approved prices and signed webhook for this billing environment are verified." });
    return;
  }
  const origin = approvedBillingOrigin(req);
  if (!origin) {
    res.status(400).json({ error: "The request host is not present in the REPLIT_DOMAINS billing redirect allowlist." });
    return;
  }
  try {
    await verifyApprovedTestPrice(tier, priceId);
    const owner = accountId(res);
    const [account] = await db.select().from(accounts).where(eq(accounts.id, owner)).limit(1);
    if (!canStartCheckout(account, billingMode()!)) {
      res.status(409).json({ error: "This account has live billing and cannot start a sandbox checkout." });
      return;
    }
    let customerId = account?.stripeBillingMode === billingMode() ? account.stripeCustomerId : null;
    let customer: Record<string, unknown> | null = null;
    if (!customerId) {
      const customerForm = new URLSearchParams();
      customerForm.set("metadata[clerkUserId]", owner);
      const customerResult = await stripePost(
        "/v1/customers",
        customerForm,
        `deallens-${billingMode()}-customer-${createHash("sha256").update(owner).digest("hex")}`,
      );
      if (customerResult.livemode !== expectedLiveMode() || typeof customerResult.id !== "string") {
        throw new Error("Stripe did not return a verified customer in the selected billing environment.");
      }
      customer = customerResult;
      customerId = customerResult.id;
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${owner}, 0))`);
        const [current] = await tx.select().from(accounts).where(eq(accounts.id, owner)).for("update").limit(1);
        if (!canStartCheckout(current, billingMode()!)) {
          throw new Error("Sandbox checkout cannot replace a live billing customer.");
        }
        if (current?.stripeBillingMode === billingMode() && current.stripeCustomerId) {
          if (current.stripeCustomerId !== customerId) {
            throw new Error("Another Stripe customer is already assigned to this account.");
          }
          return;
        }
        await tx.insert(accounts).values({ id: owner, stripeCustomerId: customerId, stripeBillingMode: billingMode()! }).onConflictDoUpdate({
          target: accounts.id,
          set: { stripeCustomerId: customerId, stripeBillingMode: billingMode()!, tier: "free", subscriptionStatus: "inactive", stripeSubscriptionId: null, periodStart: null, periodEnd: null, updatedAt: new Date() },
        });
      });
    } else {
      customer = await stripeGet(`/v1/customers/${encodeURIComponent(customerId)}`);
      const metadata = customer.metadata && typeof customer.metadata === "object"
        ? customer.metadata as Record<string, unknown>
        : null;
      if (customer.livemode !== expectedLiveMode() || customer.id !== customerId || customer.deleted === true) {
        throw new Error("The stored Stripe customer belongs to a different billing environment.");
      }
      if (metadata?.clerkUserId !== owner) {
        throw new Error("The stored Stripe customer does not belong to this account.");
      }
    }
    if (!customer) throw new Error("Could not verify the Stripe customer.");
    const sessionForm = new URLSearchParams({
      customer: customerId,
      mode: "subscription",
      success_url: billingReturnUrl(origin, "success"),
      cancel_url: billingReturnUrl(origin, "cancelled"),
      client_reference_id: owner,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][clerkUserId]": owner,
      "subscription_data[metadata][tier]": tier,
      "metadata[clerkUserId]": owner,
      "metadata[tier]": tier,
    });
    const session = await stripePost("/v1/checkout/sessions", sessionForm);
    if (session.livemode !== expectedLiveMode() || session.mode !== "subscription"
      || typeof session.url !== "string" || !session.url.startsWith("https://checkout.stripe.com/")) {
      throw new Error("Stripe did not return a verified checkout session.");
    }
    res.json({ url: session.url });
  } catch (error) {
    req.log.warn({ err: error }, "Stripe checkout unavailable");
    res.status(503).json({ error: "Could not create a checkout session in the selected billing environment." });
  }
});

router.post("/billing/portal", async (req, res): Promise<void> => {
  if (!isStripeBillingReady()) {
    res.status(503).json({ error: "Billing is not ready in this environment." });
    return;
  }
  const origin = approvedBillingOrigin(req);
  if (!origin) {
    res.status(400).json({ error: "The request host is not present in the REPLIT_DOMAINS billing redirect allowlist." });
    return;
  }
  const owner = accountId(res);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, owner)).limit(1);
  if (!account?.stripeCustomerId || account.stripeBillingMode !== billingMode()) {
    res.status(409).json({ error: "No Stripe customer is associated with this account." });
    return;
  }
  try {
    const customer = await stripeGet(`/v1/customers/${encodeURIComponent(account.stripeCustomerId)}`);
    if (customer.livemode !== expectedLiveMode() || customer.id !== account.stripeCustomerId || customer.deleted === true) {
      res.status(409).json({ error: "The account is not associated with a verified Stripe customer in this environment." });
      return;
    }
    const metadata = customer.metadata && typeof customer.metadata === "object"
      ? customer.metadata as Record<string, unknown>
      : null;
    if (metadata?.clerkUserId !== owner) {
      res.status(409).json({ error: "The Stripe customer does not belong to this account." });
      return;
    }
    const portalForm = new URLSearchParams({
      customer: account.stripeCustomerId,
      return_url: billingReturnUrl(origin),
    });
    const session = await stripePost("/v1/billing_portal/sessions", portalForm);
    if (session.livemode !== expectedLiveMode() || typeof session.url !== "string"
      || !session.url.startsWith("https://billing.stripe.com/")) {
      throw new Error("Stripe did not return a verified billing portal session.");
    }
    res.json({ url: session.url });
  } catch (error) {
    req.log.warn({ err: error }, "Stripe portal unavailable");
    res.status(503).json({ error: "Could not create a billing portal session." });
  }
});

export default router;