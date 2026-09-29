import assert from "node:assert/strict";
import test from "node:test";
import { browseTrustMrr, DiscoveryError, projectStartup, websiteDomain } from "../src/lib/trustmrr.ts";

test("provider website becomes a safe domain, not a guessed company name", () => {
  assert.deepEqual(websiteDomain("https://www.example.com/pricing"), {
    website: "https://www.example.com/pricing", domain: "example.com",
  });
  for (const invalid of [null, "", "example.com", "javascript:alert(1)", "http://localhost/", "https://a.com:8080/", "https://user:pass@example.com/"]) {
    assert.equal(websiteDomain(invalid), null);
  }
  const missing = projectStartup({ name: "Found Co", slug: "found-co", website: null, onSale: true });
  assert.equal(missing.website, null);
  assert.equal(missing.domain, null);
  assert.equal(missing.listingUrl, "https://trustmrr.com/startup/found-co");
  assert.throws(() => projectStartup({ name: "X", slug: "//evil.test" }), DiscoveryError);
});

test("browse requests only ten items and projects provider records without revenue", async () => {
  let called = 0;
  const fetcher = async (url, options) => {
    called++;
    assert.equal(url.origin, "https://trustmrr.com");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(url.searchParams.get("category"), "saas");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return new Response(JSON.stringify({
      data: [{ name: "Example", slug: "example", website: "https://www.example.com/about", category: "saas", onSale: true, revenue: { mrr: 999 } }],
      meta: { hasMore: true },
    }), { status: 200 });
  };
  const filters = { page: 20, category: "saas", sort: "listed-desc", onSale: "true" };
  const [first, second] = await Promise.all([
    browseTrustMrr(filters, "test-token", fetcher),
    browseTrustMrr(filters, "test-token", fetcher),
  ]);
  assert.equal(called, 1);
  assert.deepEqual(first, second);
  assert.equal(first.hasMore, false);
  assert.equal(first.data[0].domain, "example.com");
  assert.equal("revenue" in first.data[0], false);
  await browseTrustMrr(filters, "test-token", fetcher);
  assert.equal(called, 1);
});

test("provider rate limits and malformed responses fail explicitly", async () => {
  const empty = await browseTrustMrr(
    { page: 4, sort: "listed-desc" }, "test-token",
    async () => new Response(JSON.stringify({ data: [], meta: { hasMore: false } }), { status: 200 }),
  );
  assert.deepEqual(empty, { data: [], page: 4, hasMore: false });
  await assert.rejects(
    browseTrustMrr({ page: 3, sort: "revenue-desc" }, "test-token", async () => new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 })),
    (error) => error instanceof DiscoveryError && error.status === 503,
  );
  await assert.rejects(
    browseTrustMrr({ page: 2, sort: "revenue-desc" }, "test-token", async () => new Response("rate limited", { status: 429, headers: { "retry-after": "2" } })),
    (error) => error instanceof DiscoveryError && error.status === 429 && error.retryAfter >= 1,
  );
});