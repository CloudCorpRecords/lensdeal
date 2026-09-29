import { createHash } from "node:crypto";
import { logger } from "./logger";
import {
  approvedTestPrices,
  billingMode,
  expectedLiveMode,
  setStripeBillingReady,
  setStripePeriodicReconciliationReady,
  setStripeWebhookStatus,
  setVerifiedTestPrices,
  type VerifiedTestPrice,
} from "./billingState";
import { stripeGet, stripePost } from "./stripeClient";
import { verifyApprovedTestPrice, type BillingTier } from "./stripeValidation";
import { getStripeWebhookSecret, storeStripeWebhookSecret } from "./stripeWebhookSecrets";
import { startPeriodicStripeReconciliation } from "./webhookHandlers";

const webhookEvents = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];

function configuredWebhookUrl(): string | null {
  const configuredHost = (billingMode() === "test" ? process.env.REPLIT_DEV_DOMAIN : undefined)
    || process.env.REPLIT_DOMAINS?.split(",")[0]?.trim()
    || "";
  const host = configuredHost.trim().toLowerCase();
  if (billingMode() === "live" && (host.endsWith(".replit.dev") || host === process.env.REPLIT_DEV_DOMAIN)) return null;
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return null;
  try {
    const parsed = new URL(`https://${host}`);
    if (parsed.host.toLowerCase() !== host || parsed.pathname !== "/") return null;
    return `${parsed.origin}/api/stripe/webhook`;
  } catch {
    return null;
  }
}

function webhookForm(url: string): URLSearchParams {
  const form = new URLSearchParams({ url });
  for (const event of webhookEvents) form.append("enabled_events[]", event);
  return form;
}

async function endpointIsReady(endpointId: string, endpointUrl: string): Promise<boolean> {
  const endpoint = await stripeGet(`/v1/webhook_endpoints/${encodeURIComponent(endpointId)}`);
  if (endpoint.livemode !== expectedLiveMode()) throw new Error("Stripe webhook endpoint belongs to the wrong mode.");
  return endpoint.id === endpointId
    && endpoint.url === endpointUrl
    && endpoint.status === "enabled"
    && Array.isArray(endpoint.enabled_events)
    && webhookEvents.every((event) => (endpoint.enabled_events as unknown[]).includes(event));
}

async function ensureTestWebhook(endpointUrl: string): Promise<void> {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET is missing or too short for encrypted webhook-secret storage.");
  }
  await verifyApprovedTestPrice("pro");

  const stored = await getStripeWebhookSecret();
  if (stored?.endpointUrl === endpointUrl) {
    if (await endpointIsReady(stored.endpointId, endpointUrl)) return;
    const updated = await stripePost(
      `/v1/webhook_endpoints/${encodeURIComponent(stored.endpointId)}`,
      webhookForm(endpointUrl),
    );
    if (updated.livemode !== expectedLiveMode() || updated.id !== stored.endpointId || updated.url !== endpointUrl) {
      throw new Error("Stripe did not confirm the saved webhook endpoint.");
    }
    if (await endpointIsReady(stored.endpointId, endpointUrl)) return;
  }

  const key = createHash("sha256").update(`deallens-${billingMode()}-webhook:${endpointUrl}`).digest("hex");
  const endpoint = await stripePost(
    "/v1/webhook_endpoints",
    webhookForm(endpointUrl),
    `deallens-${billingMode()}-webhook-${key}`,
  );
  if (endpoint.livemode !== expectedLiveMode()
    || typeof endpoint.id !== "string"
    || endpoint.url !== endpointUrl
    || endpoint.status !== "enabled"
    || typeof endpoint.secret !== "string") {
    throw new Error("Stripe did not return a verifiable enabled webhook endpoint.");
  }

  await storeStripeWebhookSecret(endpoint.id, endpointUrl, endpoint.secret);
  const storedSecret = await getStripeWebhookSecret();
  if (!storedSecret
    || storedSecret.endpointId !== endpoint.id
    || storedSecret.endpointUrl !== endpointUrl
    || storedSecret.secret !== endpoint.secret
    || !(await endpointIsReady(endpoint.id, endpointUrl))) {
    throw new Error("The managed Stripe webhook could not be verified after encrypted storage.");
  }
}

export async function initializeStripeBilling(): Promise<void> {
  setStripeBillingReady(false);
  setStripeWebhookStatus(false, "Stripe webhook verification has not completed.");
  setStripePeriodicReconciliationReady(false);
  setVerifiedTestPrices({});

  if (!billingMode()) {
    setStripeWebhookStatus(false, "Stripe billing mode does not match this runtime environment.");
    logger.info("Stripe setup skipped: billing mode does not match runtime environment.");
    return;
  }

  let proxyReady = false;
  try {
    const health = await stripeGet("/v1/prices?limit=1");
    if (!Array.isArray(health.data)) throw new Error("Stripe API did not return a price list.");
    proxyReady = true;
  } catch {
    setStripeWebhookStatus(false, "The Stripe connector for this billing environment is unavailable.");
    logger.warn("Stripe connector proxy is unavailable; billing remains disabled.");
    return;
  }

  const periodicReady = await startPeriodicStripeReconciliation();
  setStripePeriodicReconciliationReady(periodicReady);

  const configured = approvedTestPrices();
  const tiers: BillingTier[] = ["pro", "team", "enterprise"];
  const uniqueIds = Object.values(configured);
  let priceValidationError = false;
  const verified: Partial<Record<BillingTier, VerifiedTestPrice>> = {};
  for (const tier of tiers) {
    const priceId = configured[tier];
    if (!priceId) {
      priceValidationError = true;
      continue;
    }
    try {
      verified[tier] = await verifyApprovedTestPrice(tier, priceId);
    } catch {
      priceValidationError = true;
    }
  }
  if (new Set(uniqueIds).size !== uniqueIds.length || tiers.some((tier) => !configured[tier])) {
    priceValidationError = true;
  }
  const allPricesVerified = !priceValidationError && tiers.every((tier) => !!verified[tier]);

  let webhookReady = false;
  const endpointUrl = configuredWebhookUrl();
  if (!allPricesVerified) {
    setStripeWebhookStatus(false, "All three approved USD prices and products must be verified before webhook provisioning.");
    logger.warn("Stripe webhook provisioning skipped because approved prices and products were not verified.");
  } else if (endpointUrl) {
    try {
      await ensureTestWebhook(endpointUrl);
      webhookReady = true;
      setStripeWebhookStatus(true);
      logger.info("Stripe webhook endpoint and encrypted signing secret were verified.");
    } catch {
      setStripeWebhookStatus(
        false,
        "Stripe webhook provisioning or verification is unavailable.",
      );
      logger.warn("Stripe webhook provisioning or verification failed; webhook delivery is not considered operational.");
    }
  } else {
    setStripeWebhookStatus(
      false,
      "No approved artifact host is configured for Stripe webhooks.",
    );
    logger.warn("Stripe webhook was not configured because no approved artifact host is available.");
  }

  setVerifiedTestPrices(verified);
  const ready = proxyReady && allPricesVerified && webhookReady;
  setStripeBillingReady(ready);
  if (ready) {
    logger.info({ mode: billingMode() }, "Stripe billing is ready: approved prices, products, and managed webhook verified.");
  } else {
    logger.info(
      { approvedTestPricesVerified: allPricesVerified, webhookReady, periodicReconciliationReady: periodicReady },
      "Stripe billing remains disabled until every approved test price and webhook is verified.",
    );
  }
}