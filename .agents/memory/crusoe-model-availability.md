---
name: Crusoe model availability
description: Live Crusoe inference model names and documentation may diverge.
---

Use the live Crusoe models catalog as the authority before selecting a hosted model, and preserve each model ID's exact casing.

**Why:** A documented example used a retired model, and a replacement copied from another documentation page still returned 404 because its casing differed from the live catalog. A third request with the catalog's exact spelling worked. This took multiple attempts and can recur as hosting changes.

**How to apply:** When a model request returns 404, check the provider's live available-models endpoint rather than guessing another ID. Never print credentials while investigating.