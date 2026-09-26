// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockToken} from "../src/mocks/MockToken.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockAMM} from "../src/mocks/MockAMM.sol";
import {SliceRouter} from "../src/SliceRouter.sol";
import {SoftLandingPool} from "../src/SoftLandingPool.sol";
import {CliffPool} from "../src/CliffPool.sol";

/// @notice Shared fixture: 3,500 mUSD/mETH, 1,000 mETH of AMM depth, 1M mUSD in each pool.
abstract contract BaseTest is Test {
    uint256 internal constant START_PRICE = 3_500e18;
    uint256 internal constant AMM_ETH = 1_000e18;
    uint256 internal constant POOL_LIQUIDITY = 1_000_000e18;

    MockToken internal meth;
    MockToken internal musd;
    MockOracle internal oracle;
    MockAMM internal amm;
    SliceRouter internal router;
    SoftLandingPool internal pool;
    CliffPool internal cliff;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");

    function setUp() public virtual {
        vm.roll(100);
        vm.warp(1_700_000_000);

        meth = new MockToken("Mock Ether", "mETH", 10e18);
        musd = new MockToken("Mock USD", "mUSD", 10_000e18);
        oracle = new MockOracle(START_PRICE);
        amm = new MockAMM(meth, musd);
        router = new SliceRouter(amm);
        pool = new SoftLandingPool(meth, musd, oracle, router);
        cliff = new CliffPool(meth, musd, oracle);

        meth.mint(address(this), AMM_ETH);
        musd.mint(address(this), AMM_ETH * START_PRICE / 1e18 + 2 * POOL_LIQUIDITY);
        meth.approve(address(amm), type(uint256).max);
        musd.approve(address(amm), type(uint256).max);
        amm.addLiquidity(AMM_ETH, AMM_ETH * START_PRICE / 1e18);

        musd.approve(address(pool), type(uint256).max);
        musd.approve(address(cliff), type(uint256).max);
        pool.fund(POOL_LIQUIDITY);
        cliff.fund(POOL_LIQUIDITY);
    }

    // ---------- helpers ----------

    function _open(address user, uint256 col, uint256 debt) internal {
        meth.mint(user, col);
        vm.startPrank(user);
        meth.approve(address(pool), type(uint256).max);
        musd.approve(address(pool), type(uint256).max);
        pool.deposit(col);
        if (debt > 0) pool.borrow(debt);
        vm.stopPrank();
    }

    function _openCliff(address user, uint256 col, uint256 debt) internal {
        meth.mint(user, col);
        vm.startPrank(user);
        meth.approve(address(cliff), type(uint256).max);
        musd.approve(address(cliff), type(uint256).max);
        cliff.deposit(col);
        if (debt > 0) cliff.borrow(debt);
        vm.stopPrank();
    }

    /// @dev Move the oracle and arbitrage the AMM to (approximately) the same price.
    function _setPrice(uint256 p) internal {
        oracle.setPrice(p);
        _arbTo(p);
    }

    /// @dev Trade the AMM toward `p` ignoring the fee; lands within ~0.3% of target.
    function _arbTo(uint256 p) internal {
        uint256 rA = amm.reserveA();
        uint256 rB = amm.reserveB();
        uint256 k = rA * rB;
        uint256 targetA = Math.sqrt(k / p * 1e18);
        if (targetA > rA) {
            uint256 amtIn = (targetA - rA) * 10_000 / (10_000 - amm.FEE_BPS());
            meth.mint(address(this), amtIn);
            amm.swapAForB(amtIn, 0, address(this));
        } else if (targetA < rA) {
            uint256 targetB = k / targetA;
            uint256 amtIn = (targetB - rB) * 10_000 / (10_000 - amm.FEE_BPS());
            musd.mint(address(this), amtIn);
            amm.swapBForA(amtIn, 0, address(this));
        }
    }

    function _col(address user) internal view returns (uint256 c) {
        (uint128 c_,,) = pool.positions(user);
        c = c_;
    }

    function _debt(address user) internal view returns (uint256 d) {
        (, uint128 d_,) = pool.positions(user);
        d = d_;
    }

    function _lastGlide(address user) internal view returns (uint256 b) {
        (,, uint64 b_) = pool.positions(user);
        b = b_;
    }
}
