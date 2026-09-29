import { Router, type IRouter } from "express";
import { CreateCheckoutBody } from "@workspace/api-zod";
import { accounts, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { accountId, requireAuth } from "../middlewares/requireAuth";
import { accountPeriod, limitsFor, usageCount } from "../lib/usage";
import { stripeGet, stripePost } from "../lib/stripeClient";
import {
  getVerifiedTestPrice,
  isStripeBillingReady,
  isStripePeriodicReconciliationReady,
  isStripeWebhookReady,
  stripeWebhookStatusNote,
} from "../lib/billingState";
import { approvedBillingOrigin, billingReturnUrl } from "../lib/billingRedirect";
import { verifyApprovedTestPrice } from "../lib/stripeValidation";
import { createHash } from "node:crypto";

const router: IRouter = Router();
const tiers = ["pro", "team", "enterprise"] as const;

function approvedPrice(tier: (typeof tiers)[number]): string | undefined {
  const priceId = process.env[`STRIPE_APPROVED_TEST_PRICE_ID_${tier.toUpperCase()}`]?.trim();
  return priceId || undefined;
}

function configuredCheckout(tier: (typeof tiers)[number]): boolean {
  return isStripeBillingReady()
    && process.env.STRIPE_BILLING_MODE === "test"
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
      enabled: isStripeBillingReady(),
      webhookVerified: isStripeWebhookReady(),
      periodicReconciliationVerified: isStripePeriodicReconciliationReady(),
      limitation: stripeWebhookStatusNote(),
    },
    note: "For configured test prices, monthlyPrice is the exact integer Stripe amount in the currency's smallest unit; currency and monthlyPriceDisplay provide the corresponding currency and formatted monthly amount. A monthlyPrice of 0 with no display means no approved test price is configured. Stripe remains test-only; live charges are disabled.",
  });
});

router.use(requireAuth);

router.get("/account", async (_req, res) => {
  const owner = accountId(res);
  const { period, tier } = await accountPeriod(owner);
  const [screensUsed, aiUsed, accountRows] = await Promise.all([
    usageCount(owner, period.start, "screens"),
    usageCount(owner, period.start, "ai"),
    db.select({ stripeCustomerId: accounts.stripeCustomerId }).from(accounts).where(eq(accounts.id, owner)).limit(1),
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
    hasBillingCustomer: !!accountRows[0]?.stripeCustomerId,
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
    res.status(503).json({ error: "Checkout is unavailable until an approved Stripe test price ID is explicitly configured." });
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
    let customerId = account?.stripeCustomerId ?? null;
    let customer: Record<string, unknown> | null = null;
    if (!customerId) {
      const customerForm = new URLSearchParams();
      customerForm.set("metadata[clerkUserId]", owner);
      const customerResult = await stripePost(
        "/v1/customers",
        customerForm,
        `deallens-customer-${createHash("sha256").update(owner).digest("hex")}`,
      );
      if (customerResult.livemode !== false || typeof customerResult.id !== "string") {
        throw new Error("Stripe did not return a verified test-mode customer.");
      }
      customer = customerResult;
      customerId = customerResult.id;
      await db.insert(accounts).values({ id: owner, stripeCustomerId: customerId }).onConflictDoUpdate({
        target: accounts.id,
        set: { stripeCustomerId: customerId, updatedAt: new Date() },
      });
    } else {
      customer = await stripeGet(`/v1/customers/${encodeURIComponent(customerId)}`);
      const metadata = customer.metadata && typeof customer.metadata === "object"
        ? customer.metadata as Record<string, unknown>
        : null;
      if (customer.livemode !== false || customer.id !== customerId || customer.deleted === true) {
        throw new Error("The stored Stripe customer is not a verified test-mode customer.");
      }
      if (metadata?.clerkUserId !== owner) {
        throw new Error("The stored Stripe customer does not belong to this account.");
      }
    }
    if (!customer) throw new Error("Could not verify the Stripe test customer.");
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
    if (session.livemode !== false || session.mode !== "subscription"
      || typeof session.url !== "string" || !session.url.startsWith("https://checkout.stripe.com/")) {
      throw new Error("Stripe did not return a verified test-mode checkout session.");
    }
    res.json({ url: session.url });
  } catch (error) {
    req.log.warn({ err: error }, "Stripe checkout unavailable");
    res.status(503).json({ error: "Could not create a test-mode checkout session." });
  }
});

router.post("/billing/portal", async (req, res): Promise<void> => {
  if (!isStripeBillingReady()) {
    res.status(503).json({ error: "The Stripe test billing connection is not initialized." });
    return;
  }
  const origin = approvedBillingOrigin(req);
  if (!origin) {
    res.status(400).json({ error: "The request host is not present in the REPLIT_DOMAINS billing redirect allowlist." });
    return;
  }
  const owner = accountId(res);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, owner)).limit(1);
  if (!account?.stripeCustomerId) {
    res.status(409).json({ error: "No Stripe customer is associated with this account." });
    return;
  }
  try {
    const customer = await stripeGet(`/v1/customers/${encodeURIComponent(account.stripeCustomerId)}`);
    if (customer.livemode !== false || customer.id !== account.stripeCustomerId || customer.deleted === true) {
      res.status(409).json({ error: "The account is not associated with a verified Stripe test customer." });
      return;
    }
    const metadata = customer.metadata && typeof customer.metadata === "object"
      ? customer.metadata as Record<string, unknown>
      : null;
    if (metadata?.clerkUserId !== owner) {
      res.status(409).json({ error: "The Stripe test customer does not belong to this account." });
      return;
    }
    const portalForm = new URLSearchParams({
      customer: account.stripeCustomerId,
      return_url: billingReturnUrl(origin),
    });
    const session = await stripePost("/v1/billing_portal/sessions", portalForm);
    if (session.livemode !== false || typeof session.url !== "string"
      || !session.url.startsWith("https://billing.stripe.com/")) {
      throw new Error("Stripe did not return a verified test-mode portal session.");
    }
    res.json({ url: session.url });
  } catch (error) {
    req.log.warn({ err: error }, "Stripe portal unavailable");
    res.status(503).json({ error: "Could not create a billing portal session." });
  }
});

export default router;