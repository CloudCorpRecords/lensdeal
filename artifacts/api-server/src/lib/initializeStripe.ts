import { runMigrations } from "stripe-replit-sync";
import { logger } from "./logger";
import {
  approvedTestPrices,
  setStripeBillingReady,
  setVerifiedTestPrices,
  type VerifiedTestPrice,
} from "./billingState";
import { getStripeSync } from "./stripeClient";

function configuredWebhookHost(): string | null {
  const host = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return null;
  try {
    const parsed = new URL(`https://${host}`);
    if (parsed.host.toLowerCase() !== host.toLowerCase() || parsed.pathname !== "/") return null;
    return host;
  } catch {
    return null;
  }
}

export async function initializeStripeBilling(): Promise<void> {
  setStripeBillingReady(false);
  setVerifiedTestPrices({});
  if (process.env.STRIPE_BILLING_MODE !== "test") {
    logger.info("Stripe setup skipped: STRIPE_BILLING_MODE=test is required; live billing remains disabled.");
    return;
  }
  const configuredPrices = approvedTestPrices();
  const priceEntries = Object.entries(configuredPrices) as Array<["pro" | "team" | "enterprise", string]>;
  if (priceEntries.length === 0) {
    logger.info("Stripe setup skipped: no explicitly approved test price IDs are configured. Configure STRIPE_APPROVED_TEST_PRICE_ID_* only after approving test prices; no Stripe products or prices are created by this service.");
    return;
  }
  if (new Set(priceEntries.map(([, id]) => id)).size !== priceEntries.length) {
    logger.warn("Stripe setup skipped: approved test price IDs must be distinct per tier.");
    return;
  }
  const host = configuredWebhookHost();
  if (!host) {
    logger.warn("Stripe setup skipped: REPLIT_DOMAINS must contain a valid host to register the managed webhook.");
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn("Stripe setup skipped: DATABASE_URL is unavailable; API will start with billing disabled.");
    return;
  }

  try {
    await runMigrations({ databaseUrl });
    const stripeSync = await getStripeSync();
    const verifiedPrices: Partial<Record<"pro" | "team" | "enterprise", VerifiedTestPrice>> = {};
    for (const [tier, priceId] of priceEntries) {
      const price = await stripeSync.stripe.prices.retrieve(priceId);
      if (!price.active || price.livemode || !price.recurring || price.recurring.interval !== "month") {
        throw new Error("An approved test price ID is not an active monthly test subscription price.");
      }
      if (price.unit_amount === null || price.unit_amount <= 0 || !Number.isSafeInteger(price.unit_amount)) {
        throw new Error("An approved test price must have a fixed integer amount for the plans catalog.");
      }
      const currency = price.currency.toUpperCase();
      const currencyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency });
      const scale = 10 ** (currencyFormat.resolvedOptions().maximumFractionDigits ?? 2);
      const display = `${currencyFormat.format(price.unit_amount! / scale)}/month`;
      verifiedPrices[tier] = {
        amountMinor: price.unit_amount!,
        currency,
        display,
      };
    }
    await stripeSync.findOrCreateManagedWebhook(`https://${host}/api/stripe/webhook`);
    await stripeSync.syncBackfill({ object: "all" });
    setVerifiedTestPrices(verifiedPrices);
    setStripeBillingReady(true);
    logger.info("Stripe test billing initialized: schema, managed webhook, and backfill are ready.");
  } catch {
    setStripeBillingReady(false);
    setVerifiedTestPrices({});
    logger.warn("Stripe test billing initialization failed; API will continue with billing disabled. Check the Stripe connection, approved test price IDs, and database configuration.");
  }
}