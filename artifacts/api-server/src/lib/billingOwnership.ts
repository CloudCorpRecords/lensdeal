import type { StripeBillingMode } from "./billingState";

type BillingAccount = {
  stripeCustomerId: string | null;
  stripeBillingMode: string;
};

// A signed event may update only the customer already assigned to this mode.
// An account without any customer can be adopted by its first verified event.
export function canReconcileBillingAccount(
  account: BillingAccount | undefined,
  mode: StripeBillingMode,
  customerId: string,
): boolean {
  return !account?.stripeCustomerId
    || (account.stripeBillingMode === mode && account.stripeCustomerId === customerId);
}

// Allow a deliberate transition from a copied sandbox account to live billing,
// but never allow development checkout to replace a live customer.
export function canStartCheckout(
  account: BillingAccount | undefined,
  mode: StripeBillingMode,
): boolean {
  return !account?.stripeCustomerId || account.stripeBillingMode === mode || mode === "live";
}