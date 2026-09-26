// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockToken} from "../../src/mocks/MockToken.sol";
import {MockAMM} from "../../src/mocks/MockAMM.sol";

/// @notice Edge #3: one 20 mETH cliff dump vs 40 slices of 0.5 mETH with a budget-limited arbitrageur
///         between slices, on identical pools. Writes results/slippage.json.
/// @dev forge test --mc SlippageExperiment -vv
contract SlippageExperiment is Test {
    uint256 internal constant PRICE = 3_500e18;
    uint256 internal constant DEPTH = 1_000e18; // mETH in the pool
    uint256 internal constant TOTAL = 20e18;
    uint256 internal constant SLICES = 40;
    uint256 internal constant ARB_BUDGET_PER_STEP = 2_000e18; // mUSD the arbitrageur can deploy per block

    MockToken internal meth;
    MockToken internal musd;

    function test_slippageExperiment() external {
        meth = new MockToken("Mock Ether", "mETH", 0);
        musd = new MockToken("Mock USD", "mUSD", 0);

        // cliff: one dump
        MockAMM cliffAmm = _pool();
        meth.mint(address(this), TOTAL);
        uint256 cliffOut = cliffAmm.swapAForB(TOTAL, 0, address(this));
        uint256 cliffFinal = cliffAmm.spotPrice();

        // glide: 40 slices, arbitrage between them
        MockAMM glideAmm = _pool();
        uint256 glideOut;
        uint256 slice = TOTAL / SLICES;
        for (uint256 i; i < SLICES; ++i) {
            meth.mint(address(this), slice);
            glideOut += glideAmm.swapAForB(slice, 0, address(this));
            _arb(glideAmm);
        }
        uint256 glideFinal = glideAmm.spotPrice();

        uint256 cliffAvg = cliffOut * 1e18 / TOTAL;
        uint256 glideAvg = glideOut * 1e18 / TOTAL;

        string memory o = "slippage";
        vm.serializeUint(o, "oraclePrice", PRICE);
        vm.serializeUint(o, "poolDepthMeth", DEPTH);
        vm.serializeUint(o, "totalSoldMeth", TOTAL);
        vm.serializeUint(o, "slices", SLICES);
        vm.serializeUint(o, "arbBudgetPerStepMusd", ARB_BUDGET_PER_STEP);
        vm.serializeUint(o, "cliffAvgPrice", cliffAvg);
        vm.serializeUint(o, "cliffFinalPrice", cliffFinal);
        vm.serializeUint(o, "cliffSlippageBps", (PRICE - cliffAvg) * 10_000 / PRICE);
        vm.serializeUint(o, "cliffPriceImpactBps", (PRICE - cliffFinal) * 10_000 / PRICE);
        vm.serializeUint(o, "glideAvgPrice", glideAvg);
        vm.serializeUint(o, "glideFinalPrice", glideFinal);
        vm.serializeUint(o, "glideSlippageBps", (PRICE - glideAvg) * 10_000 / PRICE);
        string memory json =
            vm.serializeUint(o, "glidePriceImpactBps", glideFinal >= PRICE ? 0 : (PRICE - glideFinal) * 10_000 / PRICE);
        vm.writeJson(json, "./results/slippage.json");

        assertGt(glideAvg, cliffAvg, "slices execute better than one dump");
        assertGt(glideFinal, cliffFinal, "slices leave less price damage");

        console2.log("cliff avg price  ", cliffAvg / 1e16);
        console2.log("glide avg price  ", glideAvg / 1e16);
        console2.log("cliff final spot ", cliffFinal / 1e16);
        console2.log("glide final spot ", glideFinal / 1e16);
    }

    function _pool() internal returns (MockAMM amm) {
        amm = new MockAMM(meth, musd);
        meth.mint(address(this), DEPTH);
        musd.mint(address(this), DEPTH * PRICE / 1e18);
        meth.approve(address(amm), type(uint256).max);
        musd.approve(address(amm), type(uint256).max);
        amm.addLiquidity(DEPTH, DEPTH * PRICE / 1e18);
    }

    /// @dev Buy mETH back toward the oracle price, spending at most ARB_BUDGET_PER_STEP.
    function _arb(MockAMM amm) internal {
        uint256 rA = amm.reserveA();
        uint256 rB = amm.reserveB();
        uint256 targetB = Math.sqrt(rA * rB / 1e18 * PRICE);
        if (targetB <= rB) return;
        uint256 amt = Math.min((targetB - rB) * 10_000 / (10_000 - amm.FEE_BPS()), ARB_BUDGET_PER_STEP);
        musd.mint(address(this), amt);
        amm.swapBForA(amt, 0, address(this));
    }
}
