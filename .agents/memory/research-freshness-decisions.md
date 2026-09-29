---
name: Research freshness decisions
description: Why buyer questions about current traffic need an application-level freshness rule.
---

For explicit current/latest traffic questions, let the application check the saved period and target eligibility, then decide whether a bounded fresh lookup is necessary. Treat the model's retrieval choice as advisory, not authoritative.

**Why:** In a live Crusoe check, the model returned a valid saved-only plan for “latest traffic” even though the saved evidence was older than the most recent provider period. A valid structured response was not a correct freshness decision.

**How to apply:** When expanding buyer-question planning or adding new sources, test saved-only versus current-request cases and enforce period, target, and cost rules deterministically before calling an external provider.