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
    ? " Five-minute Stripe test-mode entitlement polling is currently verified; checkout remains disabled."
    : " Periodic Stripe test-mode entitlement polling is not currently verified; checkout remains disabled.";
  return `${reason}${fallback}`;
}

export function setVerifiedTestPrices(prices: Partial<Record<"pro" | "team" | "enterprise", VerifiedTestPrice>>): void {
  verifiedTestPrices = prices;
}

export function getVerifiedTestPrice(tier: "pro" | "team" | "enterprise"): VerifiedTestPrice | undefined {
  return verifiedTestPrices[tier];
}

export function approvedTestPrices(): Partial<Record<"pro" | "team" | "enterprise", string>> {
  return {
    ...(process.env.STRIPE_APPROVED_TEST_PRICE_ID_PRO?.trim()
      ? { pro: process.env.STRIPE_APPROVED_TEST_PRICE_ID_PRO.trim() } : {}),
    ...(process.env.STRIPE_APPROVED_TEST_PRICE_ID_TEAM?.trim()
      ? { team: process.env.STRIPE_APPROVED_TEST_PRICE_ID_TEAM.trim() } : {}),
    ...(process.env.STRIPE_APPROVED_TEST_PRICE_ID_ENTERPRISE?.trim()
      ? { enterprise: process.env.STRIPE_APPROVED_TEST_PRICE_ID_ENTERPRISE.trim() } : {}),
  };
}