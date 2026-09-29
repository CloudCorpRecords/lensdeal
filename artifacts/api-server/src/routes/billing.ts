import { Router, type IRouter } from "express";
import { CreateCheckoutBody } from "@workspace/api-zod";
import { accounts, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { accountId, requireAuth } from "../middlewares/requireAuth";
import { accountPeriod, limitsFor, usageCount } from "../lib/usage";
import { getStripeClient } from "../lib/stripeClient";
import { getVerifiedTestPrice, isStripeBillingReady } from "../lib/billingState";
import { approvedBillingOrigin } from "../lib/billingRedirect";

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
    note: "For configured test prices, monthlyPrice is the exact integer Stripe amount in the currency's smallest unit; currency and monthlyPriceDisplay provide the corresponding currency and formatted monthly amount. A monthlyPrice of 0 with no display means no approved test price is configured. Live charges remain disabled pending explicit live-price approval and confirmation of Similarweb external-use rights.",
  });
});

router.use(requireAuth);

router.get("/account", async (_req, res) => {
  const owner = accountId(res);
  const { period, tier } = await accountPeriod(owner);
  const [screensUsed, aiUsed] = await Promise.all([
    usageCount(owner, period.start, "screens"),
    usageCount(owner, period.start, "ai"),
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
    const stripe = await getStripeClient();
    const price = await stripe.prices.retrieve(priceId);
    if (!price.active || price.livemode || !price.recurring || price.recurring.interval !== "month") {
      res.status(503).json({ error: "The configured Stripe price is not an active monthly test subscription price." });
      return;
    }
    const owner = accountId(res);
    const [account] = await db.select().from(accounts).where(eq(accounts.id, owner)).limit(1);
    let customerId = account?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({ metadata: { clerkUserId: owner } });
      customerId = customer.id;
      await db.insert(accounts).values({ id: owner, stripeCustomerId: customerId }).onConflictDoUpdate({
        target: accounts.id,
        set: { stripeCustomerId: customerId, updatedAt: new Date() },
      });
    }
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/deal-lens/plans?billing=success`,
      cancel_url: `${origin}/deal-lens/plans?billing=cancelled`,
      client_reference_id: owner,
      subscription_data: { metadata: { clerkUserId: owner, tier } },
      metadata: { clerkUserId: owner, tier },
    });
    if (!session.url) throw new Error("Stripe did not return a hosted checkout URL.");
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
    const stripe = await getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${origin}/deal-lens/plans`,
    });
    res.json({ url: session.url });
  } catch (error) {
    req.log.warn({ err: error }, "Stripe portal unavailable");
    res.status(503).json({ error: "Could not create a billing portal session." });
  }
});

export default router;