# DealLens

DealLens is a buyer-facing first-pass acquisition traffic screener. A buyer compares two domains using live Similarweb estimates and an evidence-constrained Crusoe brief.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the shared API server
- `pnpm --filter @workspace/deal-lens run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required server secrets: `SIMILARWEB_API_KEY`, `CRUSOE_API_KEY`. Never expose either in client code.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- This product currently has no persistence or authentication; it does not use the workspace database.
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Contract: `lib/api-spec/openapi.yaml`
- API: `artifacts/api-server/src/routes/screen.ts`, `artifacts/api-server/src/lib/screener.ts`
- UI: `artifacts/deal-lens/src/`

## Architecture decisions

- External traffic estimates are signals to verify, not evidence of fraud or a purchase recommendation.
- Each screen makes a fixed set of provider calls, and usage is limited by an in-memory daily cap and a 20-minute response cache. This is a hackathon guardrail, not production-grade abuse protection.
- The comparison window skips the most recent completed month to reduce the risk of partial data.

## Product

- Enter a target and comparison domain; inspect monthly visit estimates, channels, geography, cited findings, seller questions, and a Crusoe brief. Use browser print to save a PDF.

## User preferences

- Do not call this a fraud detector or claim to prove a seller dishonest. Display sources, periods, limitations, and verification questions with findings.

## Gotchas

- Similarweb endpoints consume credits. Do not trigger live calls during routine UI iteration.
- For standalone Vite builds, supply `PORT` and `BASE_PATH` (e.g. `PORT=23246 BASE_PATH=/ pnpm --filter @workspace/deal-lens run build`).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
