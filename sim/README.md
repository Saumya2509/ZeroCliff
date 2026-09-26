# Cascade Lab (sim)

Runs real ETH crashes through a population of borrowers twice, once under cliff liquidation and once under Soft Landing, and writes the experiment results the website and deck use. Built from `md/manali/05-crash-simulator.md`.

The engine lives in `web/lib/sim` and is shared with `/simulate`, so the numbers on the site and in the deck are identical. It mirrors all four contracts with the same bigint integer maths. `web/lib/sim/glide.test.ts` and `engine.test.ts` check it against vectors exported from the real contracts (50 glide, plus 25 each for AMM, router, cliff and full poke), and every one matches exactly.

## Commands

```bash
npm install
npm run fetch    # download ETHUSDT candles once → web/public/crashes/*.json (already committed)
npm run sim      # run E1–E7 → web/public/results/e1.json … e7.json + index.json (~2 min)

npx tsx cli.ts --run may-2021 --beta 0.3          # one scenario, summary table in the console
npx tsx cli.ts --exp E4 --out ../web/public/results  # one experiment
```

After `npm run sim`, rebuild the web app, then export the deck PNGs with `npm run charts` in `web/` (see its README).

## Data

`fetch-crashes.mjs` downloads 1-minute ETHUSDT klines from the Binance public data archive (data.binance.vision); June 2022 uses 5-minute candles to cover ten days. It keeps close prices only and records the source in each file. The whipsaw path (−20%, +15%, −20%, +20%) is synthetic.

## Model (per step, one candle)

1. **Oracle** = β × the design's own AMM price (previous step) + (1 − β) × the market price. With β = 0 no cascade is possible.
2. **Cliff pool:** every position below health 1 is liquidated (50% of debt, 8% bonus) and the liquidator dumps the seized collateral into the cliff AMM.
3. **Soft Landing:** a keeper pokes every position, at most 100 blocks apart (a candle is interval ÷ 2 s blocks). Slices go through the router's band and slippage rules; refused slices retry later; the backstop takes over below 1.02.
4. **Arbitrage** moves each AMM a share α of the way back to the market, spending at most 2% of its mUSD reserve.

Defaults: 200 borrowers of 1–20 mETH, opening health 1.30–2.00 skewed towards the risky end, AMM depth = total borrower collateral, α = 0.3, R_MAX = 0.5% per block. Each design has its own identical AMM.

## Experiments

| File | Question |
|---|---|
| `e1.json` | Each crash at β = 0: value kept and collateral lost per user |
| `e2.json` | Each crash at β = 0.3, with cascade depth |
| `e3.json` | Cascade depth as β goes from 0 to 0.5 |
| `e4.json` | AMM liquidity 0.5× – 5× (where the advantage could shrink) |
| `e5.json` | R_MAX 0.1% – 2% per block (slippage vs backstops) |
| `e6.json` | Whipsaw: does the glide over-sell in chop? |
| `e7.json` | One 20 mETH dump vs 40 slices on the same AMM (matches the Solidity experiment) |

Metric definitions and known limits are shown on `/simulate`. Two results cut against Soft Landing, and both are shown as they came out. In the whipsaw and in the mildest crash (August 2024), the glide sells *more* ETH than the cliff, though users still keep more value. And a slower R_MAX triggers more backstops without a consistent drop in slippage.
