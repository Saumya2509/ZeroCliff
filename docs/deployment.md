# Deployment guide

Deploy four pieces, in this order, because each needs the previous one's output: **contracts → indexer → keeper → website**. Target chain: **Base Sepolia (chain ID 84532)**.

Everything in step 0 was prepared and checked on 27 September 2026. Steps 1–7 need the funded wallets and accounts listed in step 0.

---

## Step 0: preparation

### Done already

| Item | Value / result |
|---|---|
| Tools | Node 24, Foundry 1.5.1, Git |
| Packages | `npm ci` succeeded for web, indexer, keeper and sim |
| Secret scan | Pre-commit hook active (`git config core.hooksPath scripts/hooks`) |
| Deployer wallet | `0x8059D29dBC9DF87916A601E07FfA0a9B1112E041` (key in `.env`, git-ignored) |
| Keeper wallet | `0x1D2Cc77a250E0EA2BB11ee1D347aF7529babf85a` (key in `.env`, git-ignored) |
| RPC | `https://sepolia.base.org` (Base's public endpoint; answered with chain ID 84532) |
| Pyth contract | `0x5f52e4DBEA21f5b23523B6e20d50c29ae0a4EB83` |
| ETH/USD feed ID | `0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` |
| Dry run | `forge script` simulated the full Pyth-mode deployment on a fork of Base Sepolia: success, about 0.0001 ETH of gas |

**Where the Pyth values come from.** Pyth's deployment registry (`contract_manager/src/store/contracts/EvmPriceFeedContracts.json` in `pyth-network/pyth-crosschain`) lists two contracts for Base Sepolia. On-chain, `0x5f52…EB83` had an ETH/USD price 25 seconds old, while `0xA2aa…5729` was 31 hours stale, so we use `0x5f52…`. It supports `getPriceNoOlderThan`, which the adapter calls. The feed ID is Hermes's `Crypto.ETH/USD`.

**No Pyth API key needed.** Since the Pyth Core upgrade (26 August 2026), Hermes refuses price-update requests without a paid API key, so our keeper can't push prices for free. Pyth pushes ETH/USD on Base Sepolia itself. We measured the gaps: usually 249–255 s, but once 2,952 s (49 minutes). So the adapter is deployed with `PYTH_MAX_AGE=3600`, accepting prices up to an hour old, and the keeper's oracle pusher stays off. The trade-off: on the testnet the price can be up to an hour stale; with a key, set `PYTH_MAX_AGE=60` and `PYTH_API_KEY` to push fresh prices every 30 s.

### Still to do (needs you)

1. **Fund the wallets with Base Sepolia test ETH** from any Base Sepolia faucet:
   - deployer `0x8059D29dBC9DF87916A601E07FfA0a9B1112E041`: about **0.1 ETH**. Deploying costs ~0.0001, but seeding 40 test positions sends 0.002 ETH of gas money to each wallet.
   - keeper `0x1D2Cc77a250E0EA2BB11ee1D347aF7529babf85a`: at least **0.05 ETH**. It pays gas for every poke, arbitrage and price push, plus Pyth's update fee.
   - Check: `cast balance <address> --ether --rpc-url https://sepolia.base.org`
2. **Pyth API key:** not needed (see above). Only if you want 60-second-fresh prices: get one from Pyth Terminal (paid) and redeploy with `PYTH_MAX_AGE=60`.
3. **Explorer API key** (for "Verified" source code): an Etherscan-family API key that covers Base Sepolia. Put it in `.env` as `EXPLORER_API_KEY`. Without it, the deploy still works, just unverified.
4. **WalletConnect project ID** (optional): from WalletConnect/Reown Cloud. Without it only browser wallets (MetaMask and similar) can connect, which is fine for judges on laptops.
5. **Push the latest commits to GitHub** (`git push`), because Railway and Vercel build from GitHub.

---

## Step 1: contracts → Base Sepolia (your laptop)

`.env` is already filled in except `EXPLORER_API_KEY`. Then:

```bash
node scripts/ops.mjs deploy-testnet
```

What happens:
1. It reads `.env` and refuses to start if `RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `PYTH_ADDRESS` or `PYTH_ETH_USD_FEED_ID` is missing.
2. `forge script script/Deploy.s.sol` deploys, one transaction at a time:
   - mETH and mUSD test tokens
   - the Pyth adapter (60 s maximum price age, confidence check)
   - the AMM, seeded with 1,000 mETH at the Pyth price, or at `START_PRICE` (2,700) if Pyth is stale at that moment
   - the slice router, SoftLandingPool and CliffPool, each funded with 1,000,000 mUSD to lend
   - 500 mETH and 2,000,000 mUSD for the keeper, for arbitrage and ghost liquidations
3. With `EXPLORER_API_KEY` set, it verifies the source on the explorer.
4. It writes `contracts/deployments/84532.json` and `active.json`, and copies the addresses into `web/lib/deployments.json` and the ABIs into web, indexer and keeper.

Check: open each address from `contracts/deployments/84532.json` on the Base Sepolia explorer. They should exist and show "Verified".

Commit the addresses (the hosted services read them from GitHub):
```bash
git add contracts/deployments/84532.json contracts/deployments/active.json web/lib/deployments.json
git commit -m "Base Sepolia deployment" && git push
```

**Run this only once.** Each run deploys brand-new contracts; afterwards you would have to commit the new addresses and redeploy everything.

Troubleshooting:
- *insufficient funds*: fund the deployer (step 0.1).
- Verification failed: the contracts are still deployed. Verify them afterwards with `forge verify-contract`; do not rerun `deploy-testnet`, which would deploy a second set.

---

## Step 2: indexer → Railway

1. railway.com → **New Project → Deploy from GitHub repo → ZeroCliff**.
2. In the project, **+ New → Database → PostgreSQL**.
3. Open the service created from the repo → **Settings**:
   - Root Directory: *leave empty* (the indexer reads `../contracts/deployments/`)
   - Build Command: `cd indexer && npm ci`
   - Start Command: `cd indexer && npx ponder start --schema $RAILWAY_DEPLOYMENT_ID --port $PORT`

     A fresh schema per deployment avoids Ponder refusing to start on a schema a previous deployment still holds.
   - Healthcheck Path: `/ready`
4. **Variables:**
   ```
   RPC_URL=https://sepolia.base.org
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```
5. **Settings → Networking → Generate Domain.**
6. Check, once the first sync is done (a minute or two):
   - `https://<indexer-domain>/ready` → 200
   - `https://<indexer-domain>/stats/pool` → JSON with both pools
   - `https://<indexer-domain>/prices?limit=5` → price ticks

The public RPC is rate-limited. If the logs show many retries, use a free RPC key from any Base Sepolia provider and put that URL in `RPC_URL`.

---

## Step 3: keeper → Railway

1. Same project → **+ New → GitHub Repo → ZeroCliff** (a second service).
2. Settings:
   - Root Directory: *empty*
   - Build Command: `cd keeper && npm ci`
   - Start Command: `cd keeper && HEALTH_PORT=$PORT npx tsx src/index.ts`
   - Healthcheck Path: `/health`
3. Variables:
   ```
   RPC_URL=https://sepolia.base.org
   CHAIN_ID=84532
   MODE=live
   KEEPER_PRIVATE_KEY=<the KEEPER_PRIVATE_KEY line from your .env>
   ```
4. Check the logs:
   - `"starting"` lists `oraclePusher: false`
   - every 60 s: `"summary"` with the gas balance
   - `"oracle pusher off: relying on Pyth's scheduled price pushes"` with `maxAgeS: "3600"`

The keeper must run 24/7: it glides positions, liquidates ghosts and keeps the AMM in line with the oracle. Watch for `keeper gas balance low` and top up the keeper wallet.

---

## Step 4: seed test positions (your laptop)

Gives the Losses Avoided counter something to count. The site labels these as team test positions.

```bash
cd keeper
SEED_PRIVATE_KEY=<the DEPLOYER_PRIVATE_KEY from .env> RPC_URL=https://sepolia.base.org CHAIN_ID=84532 SEED_COUNT=40 npm run seed
cd ..
git add contracts/deployments/seeded.json && git commit -m "Seeded test positions" && git push
```

Opens 40 paired positions (Soft Landing plus a cliff ghost, same amounts, opening health 1.40–1.90) from new burner wallets, whose keys stay in the git-ignored `keeper/.seed-keys.json`. After the push, **redeploy the indexer** so it reads `seeded.json`. Use `SEED_COUNT=20` if the deployer is low on ETH. Do **not** use `--crash` on a Pyth deployment; it only works with the mock oracle.

---

## Step 5: website → Vercel

1. vercel.com → **Add New → Project → Import ZeroCliff**.
2. **Root Directory: `web`** (Framework: Next.js, detected).
3. **Environment Variables:**
   ```
   NEXT_PUBLIC_MODE=live
   NEXT_PUBLIC_CHAIN_ID=84532
   NEXT_PUBLIC_RPC_URL=https://sepolia.base.org
   NEXT_PUBLIC_INDEXER_URL=https://<indexer-domain from step 2>
   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<optional>
   NEXT_PUBLIC_REPO_URL=https://github.com/Saumya2509/ZeroCliff
   ```
4. **Deploy.** Every push to `main` redeploys.

`NEXT_PUBLIC_*` values are built into the page, so after changing one, redeploy.

---

## Step 6: checks after deploying

- [ ] Explorer: every contract "Verified"
- [ ] Phone, fresh wallet: faucet → open a position with its ghost → the altimeter shows health
- [ ] Keeper logs: price pushes, then pokes when a position drops below 1.25; no `transaction reverted` warnings
- [ ] Indexer agrees with the chain:
  ```bash
  cast call <softLandingPool> "totalDebt()(uint256)" --rpc-url https://sepolia.base.org
  ```
  equals `totalDebt` in `https://<indexer-domain>/stats/pool` for the soft pool
- [ ] Home page: Losses Avoided shows the 40 seeded positions, "as of block N"
- [ ] `/app`: the Flight Director answers "Am I safe to sleep?" with volatility "measured"
- [ ] GitHub Actions green; README Links table filled in (site, explorer addresses)

---

## Step 7: the offline finale

Needs none of the above; see [offline/README.md](../offline/README.md).

```bash
node scripts/ops.mjs demo-offline
node scripts/ops.mjs demo-stop
```

---

## Costs

- **Base Sepolia gas:** test ETH only.
- **Vercel:** free hobby plan.
- **Railway:** an always-on keeper plus indexer plus Postgres will likely outgrow the trial credit, so budget for the cheapest paid plan. Render's free tier sleeps idle services, which would stop the keeper.
- **Pyth:** Terminal free trial, then a paid plan, for as long as the live keeper pushes prices.
