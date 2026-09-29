import { approvedTestPrices, expectedLiveMode, type VerifiedTestPrice } from "./billingState";
import { stripeGet, type StripeObject } from "./stripeClient";

export type BillingTier = "pro" | "team" | "enterprise";

const expectedAmounts: Record<BillingTier, number> = {
  pro: 14_900,
  team: 59_900,
  enterprise: 250_000,
};

function field(object: StripeObject, name: string): unknown {
  return object[name];
}

function productIdFor(price: StripeObject): string | null {
  const product = field(price, "product");
  if (typeof product === "string") return product;
  if (product && typeof product === "object" && !Array.isArray(product)) {
    const id = (product as StripeObject).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function requireCorrectMode(object: StripeObject, kind: string): void {
  if (field(object, "livemode") !== expectedLiveMode()) {
    throw new Error(`Configured Stripe ${kind} is not verified in the selected billing environment.`);
  }
}

export async function verifyApprovedTestPrice(
  tier: BillingTier,
  expectedPriceId?: string,
): Promise<VerifiedTestPrice> {
  const priceId = expectedPriceId ?? approvedTestPrices()[tier];
  if (!priceId || priceId !== approvedTestPrices()[tier]) {
    throw new Error(`An explicitly approved price ID is not configured for ${tier}.`);
  }
  const price = await stripeGet(`/v1/prices/${encodeURIComponent(priceId)}`);
  if (field(price, "id") !== priceId) throw new Error("Stripe returned a different price than requested.");
  requireCorrectMode(price, "price");
  const recurring = field(price, "recurring");
  const interval = recurring && typeof recurring === "object"
    ? (recurring as StripeObject).interval
    : undefined;
  const intervalCount = recurring && typeof recurring === "object"
    ? (recurring as StripeObject).interval_count
    : undefined;
  if (field(price, "active") !== true
    || field(price, "currency") !== "usd"
    || field(price, "unit_amount") !== expectedAmounts[tier]
    || interval !== "month"
    || intervalCount !== 1) {
    throw new Error(`The approved ${tier} price must be active, USD, and exactly $${expectedAmounts[tier] / 100}/month.`);
  }

  const productId = productIdFor(price);
  if (!productId) throw new Error("The approved Stripe price has no verifiable product.");
  const product = await stripeGet(`/v1/products/${encodeURIComponent(productId)}`);
  requireCorrectMode(product, "product");
  if (field(product, "id") !== productId || field(product, "active") !== true) {
    throw new Error("The approved Stripe price product is not active and verified.");
  }
  const metadata = field(product, "metadata");
  const label = metadata && typeof metadata === "object" ? (metadata as StripeObject) : {};
  if (label.deallens_tier !== tier
    || label.environment !== (expectedLiveMode() ? "live" : "test")
    || product.name !== `DealLens ${tier[0].toUpperCase()}${tier.slice(1)}`) {
    throw new Error("The Stripe product does not match the approved tier and billing environment.");
  }

  const currency = "USD";
  const currencyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const scale = 10 ** (currencyFormat.resolvedOptions().maximumFractionDigits ?? 2);
  const amountMinor = expectedAmounts[tier];
  return {
    amountMinor,
    currency,
    display: `${currencyFormat.format(amountMinor / scale)}/month`,
  };
}
