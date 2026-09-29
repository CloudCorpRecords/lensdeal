let stripeBillingReady = false;
let stripeWebhookReady = false;
let stripePeriodicReconciliationReady = false;
let stripeWebhookLimitation: string | null = null;

export type VerifiedTestPrice = {
  amountMinor: number;
  currency: string;
  display: string;
};

let verifiedTestPrices: Partial<Record<"pro" | "team" | "enterprise", VerifiedTestPrice>> = {};

export function setStripeBillingReady(ready: boolean): void {
  stripeBillingReady = ready;
}

export function isStripeBillingReady(): boolean {
  return stripeBillingReady;
}

export function setStripeWebhookStatus(ready: boolean, limitation: string | null = null): void {
  stripeWebhookReady = ready;
  stripeWebhookLimitation = ready ? null : limitation;
}

export function isStripeWebhookReady(): boolean {
  return stripeWebhookReady;
}

export function setStripePeriodicReconciliationReady(ready: boolean): void {
  stripePeriodicReconciliationReady = ready;
}

export function isStripePeriodicReconciliationReady(): boolean {
  return stripePeriodicReconciliationReady;
}

export function stripeWebhookStatusNote(): string | null {
  if (stripeWebhookReady) return null;
  const reason = stripeWebhookLimitation ?? "Stripe webhook provisioning is not verified.";
  const fallback = stripePeriodicReconciliationReady
    ? " Five-minute Stripe entitlement polling is currently verified; checkout remains disabled."
    : " Periodic Stripe entitlement polling is not currently verified; checkout remains disabled.";
  return `${reason}${fallback}`;
}

export function setVerifiedTestPrices(prices: Partial<Record<"pro" | "team" | "enterprise", VerifiedTestPrice>>): void {
  verifiedTestPrices = prices;
}

export function getVerifiedTestPrice(tier: "pro" | "team" | "enterprise"): VerifiedTestPrice | undefined {
  return verifiedTestPrices[tier];
}

export function approvedTestPrices(): Partial<Record<"pro" | "team" | "enterprise", string>> {
  const prefix = billingMode() === "live" ? "STRIPE_APPROVED_LIVE_PRICE_ID_" : "STRIPE_APPROVED_TEST_PRICE_ID_";
  const pro = process.env[`${prefix}PRO`]?.trim();
  const team = process.env[`${prefix}TEAM`]?.trim();
  const enterprise = process.env[`${prefix}ENTERPRISE`]?.trim();
  return {
    ...(pro ? { pro } : {}),
    ...(team ? { team } : {}),
    ...(enterprise ? { enterprise } : {}),
  };
}

export type StripeBillingMode = "test" | "live";

// Never allow live API calls in a development process, even if the mode variable is mistaken.
export function billingMode(): StripeBillingMode | null {
  if (process.env.STRIPE_BILLING_MODE === "live"
    && process.env.REPLIT_DEPLOYMENT === "1"
    && process.env.NODE_ENV === "production") return "live";
  if (process.env.STRIPE_BILLING_MODE === "test"
    && process.env.REPLIT_DEPLOYMENT !== "1"
    && process.env.NODE_ENV !== "production") return "test";
  return null;
}

export function expectedLiveMode(): boolean {
  const mode = billingMode();
  if (!mode) throw new Error("Stripe billing mode does not match the runtime environment.");
  return mode === "live";
}