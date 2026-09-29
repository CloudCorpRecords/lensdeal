---
name: Video frame capture
description: Avoid hanging direct Chromium frame capture in this environment.
---
Select a Chromium debugging target whose type is `page`, rather than the first target returned by the debugging endpoint.

**Why:** The first target can be an extension background page, where navigation/frame commands hang rather than capturing the film.

**How to apply:** When using direct CDP to sample animation frames, filter targets by type and put short timeouts on protocol commands. ImageMagick append can assemble a contact sheet without Python imaging packages.