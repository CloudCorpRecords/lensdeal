import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { approvedTestPrices, billingMode, expectedLiveMode } from "../src/lib/billingState.ts";
import { canReconcileBillingAccount, canStartCheckout } from "../src/lib/billingOwnership.ts";
import { verifyStripeSignature } from "../src/lib/stripeWebhookSignature.ts";

const keys = [
  "NODE_ENV", "REPLIT_DEPLOYMENT", "STRIPE_BILLING_MODE",
  "STRIPE_APPROVED_TEST_PRICE_ID_PRO", "STRIPE_APPROVED_LIVE_PRICE_ID_PRO",
];

function withEnvironment(values, callback) {
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    callback();
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
}

test("live billing needs an actual production runtime, not only a mode variable", () => {
  for (const runtime of [
    { NODE_ENV: "development" },
    { NODE_ENV: "production" },
    { NODE_ENV: "development", REPLIT_DEPLOYMENT: "1" },
  ]) {
    withEnvironment({ ...runtime, STRIPE_BILLING_MODE: "live" }, () => {
      assert.equal(billingMode(), null);
      assert.throws(() => expectedLiveMode());
    });
  }
});

test("test and live price IDs are never substituted across environments", () => {
  const ids = {
    STRIPE_APPROVED_TEST_PRICE_ID_PRO: "price_test_pro",
    STRIPE_APPROVED_LIVE_PRICE_ID_PRO: "price_live_pro",
  };
  withEnvironment({
    ...ids, NODE_ENV: "development", STRIPE_BILLING_MODE: "test",
  }, () => {
    assert.equal(billingMode(), "test");
    assert.equal(expectedLiveMode(), false);
    assert.equal(approvedTestPrices().pro, "price_test_pro");
  });
  withEnvironment({
    ...ids, NODE_ENV: "production", REPLIT_DEPLOYMENT: "1", STRIPE_BILLING_MODE: "live",
  }, () => {
    assert.equal(billingMode(), "live");
    assert.equal(expectedLiveMode(), true);
    assert.equal(approvedTestPrices().pro, "price_live_pro");
  });
  withEnvironment({
    ...ids, NODE_ENV: "production", REPLIT_DEPLOYMENT: "1", STRIPE_BILLING_MODE: "test",
  }, () => assert.equal(billingMode(), null));
});

test("a signed sandbox subscription event cannot replace a live paid customer", () => {
  const secret = "whsec_test_regression";
  const now = Date.now();
  const timestamp = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    id: "evt_test_after_live",
    livemode: false,
    type: "customer.subscription.updated",
    data: { object: { livemode: false, customer: "cus_test", status: "canceled" } },
  }));
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload.toString()}`).digest("hex");
  assert.equal(verifyStripeSignature(payload, `t=${timestamp},v1=${digest}`, secret, now), true);
  const paidLiveAccount = { stripeBillingMode: "live", stripeCustomerId: "cus_live" };
  assert.equal(canReconcileBillingAccount(paidLiveAccount, "test", "cus_test"), false);
  assert.equal(canStartCheckout(paidLiveAccount, "test"), false);
  assert.equal(canReconcileBillingAccount(paidLiveAccount, "live", "cus_live"), true);
  assert.equal(canReconcileBillingAccount(paidLiveAccount, "live", "cus_other"), false);
  assert.equal(canStartCheckout({ stripeBillingMode: "test", stripeCustomerId: "cus_test" }, "live"), true);
});