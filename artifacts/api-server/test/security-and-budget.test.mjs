import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { sameOriginSecurity } from "../src/middlewares/sameOriginSecurity.ts";
import { ProviderError, Semaphore } from "../src/lib/screener.ts";
import { verifyStripeSignature } from "../src/lib/stripeWebhookSignature.ts";
import { comparisonGuide } from "../src/lib/comparisonGuide.ts";

test("comparison guide separates saved peer signals from the later target-only observation", () => {
  const guide = comparisonGuide({
    period: "2026-05 to 2026-07",
    target: { domain: "nike.com", averageVisits: 119419420, trafficChangePercent: 9.38 },
    comparison: { domain: "adidas.com", averageVisits: 42062799, trafficChangePercent: 38.81 },
  }, {
    domain: "nike.com", metric: "Estimated monthly visits", visits: 124488692,
    period: "2026-08", source: "Fresh Similarweb traffic-and-engagement estimate",
    sourceUrl: "https://example.com/method", retrievedAt: "2026-09-29T00:00:00Z",
  });
  assert.equal(guide.reachComparison?.higherReachDomain, "nike.com");
  assert.equal(guide.reachComparison?.multiple, 2.8);
  assert.equal(guide.momentumComparison?.fasterGrowthDomain, "adidas.com");
  assert.equal(guide.momentumComparison?.gapPercentagePoints, 29.4);
  assert.equal(guide.freshTargetOnly.domain, "nike.com");
  assert.match(guide.freshTargetOnly.note, /do not compare.*peer/i);
  const noRatio = comparisonGuide({
    target: { domain: "zero.example", averageVisits: 0, trafficChangePercent: null },
    comparison: { domain: "peer.example", averageVisits: 10, trafficChangePercent: 1 },
  }, {
    domain: "zero.example", metric: "Estimated monthly visits", visits: 1,
    period: "2026-08", source: "Fresh Similarweb traffic-and-engagement estimate",
    sourceUrl: "https://example.com/method", retrievedAt: "2026-09-29T00:00:00Z",
  });
  assert.equal(noRatio.reachComparison, null);
  assert.equal(noRatio.momentumComparison, null);
});

function response() {
  return {
    code: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

function invokeSecurity({ host, origin, fetchSite, method = "POST" }) {
  const req = {
    method,
    get(name) {
      return ({
        host,
        origin,
        "sec-fetch-site": fetchSite,
      })[name.toLowerCase()];
    },
  };
  const res = response();
  let passed = false;
  sameOriginSecurity(req, res, () => { passed = true; });
  return { passed, ...res };
}

test("CORS/CSRF policy permits only an exact configured same-origin host", () => {
  process.env.NODE_ENV = "production";
  process.env.REPLIT_DOMAINS = "app.example.test";
  delete process.env.REPLIT_DEV_DOMAIN;

  assert.equal(invokeSecurity({
    host: "app.example.test",
    origin: "https://app.example.test",
    fetchSite: "same-origin",
  }).passed, true);
  assert.equal(invokeSecurity({
    host: "attacker.replit.dev",
    origin: "https://attacker.replit.dev",
    fetchSite: "same-origin",
  }).code, 403);
  assert.equal(invokeSecurity({
    host: "app.example.test",
    origin: "https://evil.example",
    fetchSite: "cross-site",
  }).code, 403);
  assert.equal(invokeSecurity({
    host: "app.example.test",
    fetchSite: "same-origin",
  }).passed, true);
  assert.equal(invokeSecurity({
    host: "unknown.example.test",
  }).code, 403);
});

test("Similarweb semaphore caps active work and bounds its waiting queue", async () => {
  process.env.DEALLENS_SIMILARWEB_MAX_CONCURRENCY = "2";
  process.env.DEALLENS_SIMILARWEB_MAX_QUEUE = "1";
  const semaphore = new Semaphore();
  const releaseOne = await semaphore.acquire();
  const releaseTwo = await semaphore.acquire();
  const thirdRequest = semaphore.acquire();
  await assert.rejects(semaphore.acquire(), ProviderError);
  releaseOne();
  const releaseThree = await thirdRequest;
  releaseTwo();
  releaseThree();
});

test("Stripe webhook signatures use exact raw payload, timing-safe digest, and tolerance", () => {
  const secret = "whsec_test_only_example";
  const payload = Buffer.from('{"id":"evt_test","livemode":false}');
  const now = 1_750_000_000_000;
  const timestamp = Math.floor(now / 1000);
  const digest = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), payload]))
    .digest("hex");
  const header = `t=${timestamp},v1=${digest}`;

  assert.equal(verifyStripeSignature(payload, header, secret, now), true);
  assert.equal(verifyStripeSignature(Buffer.from(`${payload.toString()} `), header, secret, now), false);
  assert.equal(verifyStripeSignature(payload, header, secret, now + 301_000), false);
});