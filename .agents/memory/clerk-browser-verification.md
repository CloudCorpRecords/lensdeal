---
name: Clerk browser verification
description: Constraint on automated signed-in billing checks in the managed development auth environment.
---

Automated browser sign-up can encounter a Cloudflare human-verification challenge in the managed Clerk development instance. Treat it as a real limit on end-to-end verification rather than bypassing it or reporting untested checkout flows as working.

**Why:** A browser verification pass reached the challenge before it could create a legitimate development account, so signed-in checkout, webhook-driven entitlements, and portal cancellation were not directly observed despite healthy public billing status.

**How to apply:** For future authenticated billing checks, obtain a legitimate development test account through an authorized path or have a human complete the challenge. Until then, distinguish startup/catalog and unit-test evidence from actual paid-journey evidence.