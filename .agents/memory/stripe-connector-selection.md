---
name: Stripe connector selection
description: Environment-specific Stripe connection behavior when development and production connections coexist.
---

When both sandbox and live Stripe connections are attached, do not assume an unqualified connector proxy call automatically chooses the connection for the running environment. Select a healthy connection whose declared environment matches the runtime before proxying, and verify the returned objects' livemode.

**Why:** After a live account was connected, a development proxy request unexpectedly returned live prices. The app correctly failed closed, but sandbox checkout was disabled until the connection was selected explicitly.

**How to apply:** Any new server-side Stripe call should use the existing environment-aware request layer rather than calling the connector proxy directly. Do not hardcode connection IDs; they can change on reconnect.