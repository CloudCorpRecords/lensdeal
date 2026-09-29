import assert from "node:assert/strict";
import test from "node:test";
import { findingsFor } from "../src/lib/screener.ts";
import { comparisonGuide } from "../src/lib/comparisonGuide.ts";
import { screenAccessError, screenUnits } from "../src/lib/screenPolicy.ts";

const target = {
  domain: "example.com", monthlyVisits: [], averageVisits: 1000,
  trafficChangePercent: -25, channels: [], geography: [],
  topCountry: null, topChannel: null,
};
const peer = { ...target, domain: "peer.com", averageVisits: 2000 };
const fresh = {
  domain: "example.com", metric: "Estimated monthly visits", visits: 800,
  period: "2026-08", source: "Similarweb", sourceUrl: "https://example.com/method",
  retrievedAt: "2026-09-29T00:00:00Z",
};

test("target-only findings and follow-up guide never fabricate a peer", () => {
  const findings = findingsFor(target, undefined, "2026-06 to 2026-08");
  assert.ok(findings.some((item) => item.title === "Recent traffic decline"));
  assert.equal(findings.some((item) => item.title === "Peer traffic benchmark"), false);
  assert.ok(findings.every((item) => item.sourceUrl && item.verificationQuestion));
  const guide = comparisonGuide({ target, period: "2026-06 to 2026-08" }, fresh);
  assert.equal(guide.savedProfiles.length, 1);
  assert.equal(guide.reachComparison, null);
  assert.equal(guide.momentumComparison, null);
  assert.doesNotMatch(guide.freshTargetOnly.note, /peer/i);
  assert.ok(findingsFor(target, peer, "2026-06 to 2026-08").some((item) => item.title === "Peer traffic benchmark"));
});

test("solo charges one unit, each peer one unit, and tier/provider caps hold", () => {
  assert.equal(screenUnits(0), 1);
  assert.equal(screenUnits(1), 1);
  assert.equal(screenUnits(8), 8);
  assert.equal(screenUnits(19), 19);
  assert.equal(screenAccessError(0, "free", 8), null);
  assert.equal(screenAccessError(1, "pro", 8), null);
  assert.equal(screenAccessError(2, "team", 8)?.status, 403);
  assert.equal(screenAccessError(8, "enterprise", 8), null);
  assert.equal(screenAccessError(9, "enterprise", 8)?.status, 413);
  assert.equal(screenAccessError(19, "enterprise", 30), null);
  assert.equal(screenAccessError(20, "enterprise", 30)?.status, 413);
});