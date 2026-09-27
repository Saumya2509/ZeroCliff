// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {IOracle} from "../src/interfaces/IOracle.sol";
import {MockToken} from "../src/mocks/MockToken.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockAMM} from "../src/mocks/MockAMM.sol";
import {SliceRouter} from "../src/SliceRouter.sol";
import {PythOracleAdapter} from "../src/PythOracleAdapter.sol";
import {SoftLandingPool} from "../src/SoftLandingPool.sol";
import {CliffPool} from "../src/CliffPool.sol";

/// @notice Deploys the whole system and writes deployments/<chainId>.json and deployments/active.json,
///         which the web app, indexer and keeper read.
///
///         ORACLE_MODE=mock (default): MockOracle owned by the deployer. Local anvil and demo deployments.
///         ORACLE_MODE=pyth: PythOracleAdapter over PYTH_ADDRESS / PYTH_ETH_USD_FEED_ID. Public testnet.
///
///         PYTH_MAX_AGE (seconds, default 7 days): oldest Pyth price accepted on testnet.
///         No Pyth key required when using public Hermes (https://hermes.pyth.network).
///         Optional: START_PRICE (whole mUSD, default 3500; in Pyth mode the live price is used when fresh),
///         AMM_METH (default 1000), POOL_LIQUIDITY (mUSD per pool, default 1,000,000),
///         KEEPER_ADDRESS (gets mETH + mUSD inventory for arbitrage and ghost liquidations).
///
///         forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast
contract Deploy is Script {
    MockToken internal meth;
    MockToken internal musd;
    MockOracle internal mockOracle;
    PythOracleAdapter internal pythAdapter;
    IOracle internal oracle;
    MockAMM internal amm;
    SliceRouter internal router;
    SoftLandingPool internal pool;
    CliffPool internal cliff;
    uint256 internal startBlock;
    uint256 internal price;
    bool internal pythMode;

    function run() external {
        pythMode = keccak256(bytes(vm.envOr("ORACLE_MODE", string("mock")))) == keccak256("pyth");
        startBlock = block.number;

        vm.startBroadcast();
        _deployCore();
        _seedLiquidity();
        _fundKeeper();
        vm.stopBroadcast();

        _write();
    }

    function _deployCore() internal {
        meth = new MockToken("Mock Ether", "mETH", 10e18);
        musd = new MockToken("Mock USD", "mUSD", 10_000e18);

        price = vm.envOr("START_PRICE", uint256(3_500)) * 1e18;
        if (pythMode) {
            pythAdapter = new PythOracleAdapter(
                IPyth(vm.envAddress("PYTH_ADDRESS")),
                vm.envBytes32("PYTH_ETH_USD_FEED_ID"),
                vm.envOr("PYTH_MAX_AGE", uint256(7 days))
            );
            oracle = pythAdapter;
            // Seed the AMM at the live price when the feed is fresh, so the router's 2% band is met from block one.
            try pythAdapter.getPrice() returns (uint256 p, uint256) {
                price = p;
            } catch {
                console2.log("Pyth price stale or unavailable; seeding the AMM at START_PRICE");
            }
        } else {
            mockOracle = new MockOracle(price);
            oracle = mockOracle;
        }

        amm = new MockAMM(meth, musd);
        router = new SliceRouter(amm);
        pool = new SoftLandingPool(meth, musd, oracle, router);
        cliff = new CliffPool(meth, musd, oracle);
    }

    function _seedLiquidity() internal {
        address me = msg.sender;
        uint256 ammEth = vm.envOr("AMM_METH", uint256(1_000)) * 1e18;
        uint256 ammUsd = ammEth * price / 1e18;
        uint256 lend = vm.envOr("POOL_LIQUIDITY", uint256(1_000_000)) * 1e18;

        meth.mint(me, ammEth);
        musd.mint(me, ammUsd + 2 * lend);
        meth.approve(address(amm), ammEth);
        musd.approve(address(amm), ammUsd);
        amm.addLiquidity(ammEth, ammUsd);

        musd.approve(address(pool), lend);
        pool.fund(lend);
        musd.approve(address(cliff), lend);
        cliff.fund(lend);
    }

    function _fundKeeper() internal {
        address keeper = vm.envOr("KEEPER_ADDRESS", address(0));
        if (keeper == address(0)) return;
        meth.mint(keeper, 500e18);
        musd.mint(keeper, 2_000_000e18);
    }

    function _write() internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", startBlock);
        vm.serializeString(k, "oracleMode", pythMode ? "pyth" : "mock");
        vm.serializeAddress(k, "deployer", msg.sender);
        vm.serializeAddress(k, "mETH", address(meth));
        vm.serializeAddress(k, "mUSD", address(musd));
        vm.serializeAddress(k, "mockOracle", address(mockOracle));
        vm.serializeAddress(k, "pythAdapter", address(pythAdapter));
        vm.serializeAddress(k, "amm", address(amm));
        vm.serializeAddress(k, "sliceRouter", address(router));
        vm.serializeAddress(k, "cliffPool", address(cliff));
        string memory json = vm.serializeAddress(k, "softLandingPool", address(pool));

        string memory file = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, file);
        vm.writeJson(json, "deployments/active.json");
        console2.log("wrote", file, "and deployments/active.json");
    }
}
