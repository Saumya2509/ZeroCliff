# Soft Landing contracts

Foundry project. Solidity 0.8.24, OpenZeppelin 5.4, Pyth SDK.

| Contract | Job |
|---|---|
| `src/SoftLandingPool.sol` | The product: deposit, borrow, repay, withdraw, per-block glide, backstop, Landing Forecast |
| `src/CliffPool.sol` | Baseline with classic 50% / 8% liquidation; hosts ghost positions |
| `src/LendingPoolBase.sol` | Shared accounting for both pools (same `LT`, same `H_open`) |
| `src/SliceRouter.sol` | Sells slices into the AMM behind a 2% oracle band and a 1.5% `minOut` |
| `src/PythOracleAdapter.sol` | Pyth feed behind `IOracle` (age, confidence and exponent checks) |
| `src/mocks/` | `MockToken` (faucet), `MockOracle` (settable price), `MockAMM` (x·y = k) |

Maths and rules: [../docs/mechanism.md](../docs/mechanism.md). Security results: [../docs/security.md](../docs/security.md).

## Commands

```bash
forge build
forge test                                          # everything, including invariants (~5 min)
forge test --no-match-contract InvariantsTest -vv > results/test-output.txt   # fast loop; feeds /transparency
forge test --mc InvariantsTest -vv                  # I1–I7, with path-coverage counters
forge test --mc AttackScenariosTest -vv             # A1–A7, prints A1 before/after
forge test --mc SlippageExperiment -vv              # writes results/slippage.json
WRITE_GAS=1 forge test --mc GasReportTest --isolate  # writes results/gas.json
forge test --mc ExportVectorsTest                   # writes vectors/glide_*.json (simulator parity)
```

## Outputs used elsewhere

| File | Used by |
|---|---|
| `vectors/glide_0..49.json` | Simulator parity tests (05). All integers are decimal strings |
| `results/slippage.json` | Deck and `/simulate` (Edge #3) |
| `results/gas.json` | `docs/gas.md`, deck |

Deployment scripts are not written yet; they come later with 08.
