import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Bundle the isolated library so Node's strip-types runner can resolve its TS imports.
const directory = await mkdtemp(join(tmpdir(), "deallens-copilot-"));
const output = join(directory, "copilot.mjs");
await build({ entryPoints: [new URL("../src/lib/copilot.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", outfile: output, logLevel: "silent" });
const { prepareCopilotEvidence, validateCopilotPlan, renderCopilotAnswer, chooseCopilotPlan, currentLookupPolicy, EvidenceError } = await import(pathToFileURL(output).href);
await rm(directory, { recursive: true, force: true });

const report = (domain, period, change = null, peer = null) => ({
  generatedAt: "2026-09-01T12:00:00.000Z",
  period,
  target: { domain, averageVisits: 5000, trafficChangePercent: change, monthlyVisits: [{ month: "2026-06", visits: 4500 }, { month: "2026-07", visits: 5500 }] },
  ...(peer ? { comparison: { domain: peer, averageVisits: 3000, trafficChangePercent: -2, monthlyVisits: [{ month: "2026-07", visits: 3000 }] } } : {}),
  sellerQuestions: ["Can the seller provide their GA4 visitor and conversion reports for these months?"],
});

test("target-only and mixed-period reports produce distinct cited facts without invented peers", () => {
  const evidence = prepareCopilotEvidence([
    { id: "screen-a", report: report("solo.example", "2026-06 to 2026-07") },
    { id: "screen-b", report: report("target.example", "2026-04 to 2026-05", -23, "peer.example") },
  ]);
  assert.equal(evidence.citations.length, 5);
  assert.equal(evidence.periods.length, 2);
  assert.equal(evidence.facts.filter((f) => f.text.includes("peer.example")).length, 3);
  assert.equal(evidence.facts.filter((f) => f.text.includes("solo.example")).length, 3);
  const plan = validateCopilotPlan({ useFresh: false, targetReportId: null, evidenceIds: ["E1", "E4"], questionIds: ["Q1"] }, evidence);
  const result = renderCopilotAnswer(evidence, plan);
  assert.match(result.answer, /different periods/);
  assert.match(result.answer, /solo\.example.*\[1\]/);
  assert.match(result.answer, /target\.example.*\[2\]/);
  assert.equal(result.freshLookup, false);
  assert.deepEqual(result.citations.map((c) => c.reportId), ["screen-a", "screen-b", "screen-a"]);
  assert.equal(result.citations.some((c) => c.domain === "peer.example"), false);
});

test("the model cannot select unsupported citations, duplicate facts, or an unapproved target", () => {
  const evidence = prepareCopilotEvidence([{ id: "mine", report: report("valid.example", "2026-06 to 2026-07") }]);
  for (const plan of [
    { useFresh: false, targetReportId: null, evidenceIds: ["E99"], questionIds: [] },
    { useFresh: false, targetReportId: null, evidenceIds: ["E1", "E1"], questionIds: [] },
    { useFresh: true, targetReportId: "not-mine", evidenceIds: ["E1"], questionIds: [] },
  ]) assert.throws(() => validateCopilotPlan(plan, evidence), /unsupported evidence/);
  const freshPlan = validateCopilotPlan({ useFresh: true, targetReportId: "mine", evidenceIds: ["E1"], questionIds: [] }, evidence);
  assert.throws(() => renderCopilotAnswer(evidence, freshPlan), EvidenceError);
  const result = renderCopilotAnswer(evidence, freshPlan, {
    domain: "valid.example", visits: 6100, period: "2026-08", retrievedAt: "2026-09-02T00:00:00Z",
    sourceUrl: "https://docs.similarweb.com/", source: "Fresh Similarweb traffic-and-engagement estimate",
  });
  assert.equal(result.freshLookup, true);
  assert.match(result.answer, /6,100.*\[2\]/);
  assert.equal(result.citations.at(-1).reportId, null);
});

test("insufficient or oversized evidence fails before consuming provider credits", () => {
  assert.throws(() => prepareCopilotEvidence([]), EvidenceError);
  assert.throws(() => prepareCopilotEvidence(Array.from({ length: 7 }, (_, i) => ({ id: String(i), report: report("valid.example", "2026-06") }))), EvidenceError);
  assert.throws(() => prepareCopilotEvidence([{ id: "bad", report: { period: "2026-06", target: {} } }]), EvidenceError);
});

test("current-traffic questions resolve a single target and avoid already-current provider calls", () => {
  const screens = [
    { id: "a", report: report("alpha.example", "2026-06 to 2026-07", null, "peer.example") },
    { id: "b", report: report("beta.example", "2026-08") },
  ];
  const now = new Date("2026-09-29T12:00:00Z");
  assert.deepEqual(currentLookupPolicy("What changed in traffic?", screens, now), { explicit: false, targetReportId: null, needsLookup: false });
  assert.deepEqual(currentLookupPolicy("Latest traffic for alpha.example?", screens, now), { explicit: true, targetReportId: "a", needsLookup: true });
  assert.deepEqual(currentLookupPolicy("Current visits for beta.example?", screens, now), { explicit: true, targetReportId: "b", needsLookup: false });
  assert.deepEqual(currentLookupPolicy("What is the current revenue?", screens, now), { explicit: false, targetReportId: null, needsLookup: false });
  assert.throws(() => currentLookupPolicy("Current visits?", screens, now), /name one target/);
  assert.throws(() => currentLookupPolicy("Latest visits for peer.example?", screens, now), /saved target/);
});

test("unsupported business claims are explicitly refused while selected traffic remains context", () => {
  const evidence = prepareCopilotEvidence([{ id: "screen", report: report("alpha.example", "2026-06") }]);
  const plan = validateCopilotPlan({ useFresh: false, targetReportId: null, evidenceIds: ["E1"], questionIds: [] }, evidence);
  const rendered = renderCopilotAnswer(evidence, plan, undefined, "What was revenue?");
  assert.match(rendered.answer, /cannot establish the business outcome/);
  assert.match(rendered.answer, /Traffic context only/);
  assert.doesNotMatch(rendered.answer.split("### Traffic context only")[0], /5,000/);
  assert.equal(rendered.citations.length, 1);
});

test("Crusoe's bounded plan is validated, including provider failure", async () => {
  const evidence = prepareCopilotEvidence([{ id: "mine", report: report("valid.example", "2026-06") }]);
  const good = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.model, "deepseek-ai/Deepseek-V4-Flash");
    assert.equal(options.headers.Authorization, "Bearer test-only");
    assert.equal(JSON.stringify(request).includes("TrustMRR"), false);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"useFresh":false,"targetReportId":null,"evidenceIds":["E1"],"questionIds":[]}' } }] }), { status: 200 });
  };
  assert.equal((await chooseCopilotPlan("What are the visits?", evidence, good, "test-only")).useFresh, false);
  await assert.rejects(chooseCopilotPlan("What are the visits?", evidence, async () => new Response("bad", { status: 503 }), "test-only"), /HTTP 503/);
  await assert.rejects(chooseCopilotPlan("What are the visits?", evidence, async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }), "test-only"), /unsupported evidence/);
});