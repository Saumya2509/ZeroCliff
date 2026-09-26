# Soft Landing web app

Next.js 16 (App Router) · wagmi 2 · viem · RainbowKit · TanStack Query · Tailwind 4 · Recharts. Built from `md/manali/04-frontend-web-app.md`.

| Route | What it is |
|---|---|
| `/` | Pitch, hero chart (computed by the replay engine), losses-avoided counter |
| `/app` | The dApp: faucet, open position (+ ghost), Health Altimeter, ghost chart, Landing Forecast, activity |
| `/simulate` | Cascade Lab: real ETH crashes through cliff vs glide, each with its own AMM; experiments E1–E7 |
| `/transparency` | Live pool stats, contracts, test / invariant / gas / slippage results |
| `/how-it-works` | Glide curve, formulas, parameters, threat model, known limits |
| `/admin` | Hidden demo price controls, only for the MockOracle owner |

## Run

```bash
npm install
cp .env.example .env.local     # set chain, RPC, optional WalletConnect id
npm run dev
```

Offline (anvil on 127.0.0.1:8545, injected wallet only): `NEXT_PUBLIC_MODE=offline npm run build && npm start`.

## Where the data comes from

- **ABIs and addresses:** `npm run abis` (runs `../scripts/export-abis.mjs`). It writes `lib/abis/*.ts` from `contracts/out`, and copies `contracts/deployments/active.json` to `lib/deployments.json` once it exists. Until then the app shows a "not deployed yet" state wherever it needs the chain.
- **Test results on /transparency:** `node ../scripts/collect-results.mjs` builds `lib/results.json` from `contracts/results/`.
- **Maths:** `lib/sim/glide.ts` is a line-for-line bigint port of the contract. `lib/sim/glide.test.ts` checks it against all 50 contract test vectors; every one matches exactly.
- **Cascade Lab (`/simulate`):** `lib/sim/run.ts` is the step loop; `amm.ts`, `router.ts` and `pools.ts` mirror MockAMM, SliceRouter, SoftLandingPool.poke and CliffPool.liquidate, checked by `lib/sim/engine.test.ts` against 100 vectors exported from the contracts. The page runs it in a Web Worker (`lib/sim/worker.ts`); the scenario lives in the URL, e.g. `/simulate?crash=may-2021&beta=0.3`. Crash data is in `public/crashes`, experiment results in `public/results` (both made by `../sim`, see its README).
- **Deck charts:** with `npx next start -p 3100` running, `npm run charts` screenshots each experiment figure into `public/results/charts/e1.png … e7.png`.
- **History and activity:** `hooks/useHistory.ts` reads the indexer's `/activity/:user` when `NEXT_PUBLIC_INDEXER_URL` is set, and falls back silently to contract events from the last ~5,000 blocks (`lib/fallbackActivity.ts`) when it is not or is down. The ghost chart is rebuilt backwards from the current position, so a truncated history starts later instead of being wrong.
- **Losses Avoided (home):** the indexer's `/stats/losses-avoided` (see `../indexer/README.md` for the exact definition), shown with better / worse / equal counts, "as of block N", and a label for the team's seeded test positions. When the indexer is down it reads "Stats temporarily unavailable" instead of a stale number.

## Checks

```bash
npm test          # Vitest: parity vectors (glide + engine), Cascade Lab loop, format, errors, HealthAltimeter
npm run lint
npm run build
npm run e2e       # Playwright: every page at 375 px, 1280 px and dark; no console errors,
                  # no horizontal scroll, no requests leaving localhost; Cascade Lab worker,
                  # URL parameters and JSON download
```

## Design

Tokens live in `app/globals.css` (primitive → semantic → Tailwind theme), using the Manali palette from the brief. Text colours were checked against WCAG AA. Signal amber and mist fail as text on the light background, so text uses darker "ink" variants, and dark mode has its own checked set. Red is used only for the cliff pool. Fonts (IBM Plex Sans / Mono) are self-hosted in `app/fonts` so the offline build makes no external requests.

`next.config.ts` aliases `@coinbase/cdp-sdk` to a stub. RainbowKit bundles Base Account, whose subscription helpers import that SDK and its uninstalled optional x402 packages. We never use subscriptions.
