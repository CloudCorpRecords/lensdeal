---
name: Similarweb external-use licensing
description: The commercial launch constraint for externally exposed Similarweb estimates.
---

Do not infer customer-facing redistribution rights from a working Similarweb API key. Similarweb's developer site explicitly invites product builders with external users to discuss a separate data license with its OEM team. Its API credit documentation also says consumption varies by endpoint, time range, country, granularity, and returned results.

The DealLens creator stated that their Similarweb agreement covers showing the data to external paying users. This is their confirmation, not an independent review of the agreement. They approved the proposed Pro, Team, and Enterprise prices for **Stripe test checkout only**; they did not approve live charges.

**Why:** DealLens may serve paid external users, while the current API access does not establish either those license rights or the per-customer cost of the proposed allowances. See https://developer.similarweb.com/ and https://docs.similarweb.com/api-v5/guides/data-credits-calculations .

**How to apply:** Treat the creator's licensing statement as permission to continue test flows, not as permission to enable live charges. Before a public paid launch, calculate actual credit costs against the endpoints and expected usage, and obtain separate live-billing approval.