let stripeBillingReady = false;

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