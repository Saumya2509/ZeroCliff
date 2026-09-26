// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../Base.t.sol";
import {SoftLandingPool} from "../../src/SoftLandingPool.sol";
import {LendingPoolBase} from "../../src/LendingPoolBase.sol";
import {MockOracle} from "../../src/mocks/MockOracle.sol";

contract SoftLandingPoolTest is BaseTest {
    uint256 internal constant COMFORT = 1.25e18;
    uint256 internal constant TOL = 1e15; // 0.001 health

    // ---------- deposit / borrow / repay / withdraw ----------

    function test_depositUpdatesPositionAndTotals() public {
        meth.mint(alice, 5e18);
        vm.startPrank(alice);
        meth.approve(address(pool), 5e18);
        vm.expectEmit(true, false, false, true);
        emit LendingPoolBase.Deposited(alice, 5e18);
        pool.deposit(5e18);
        vm.stopPrank();
        assertEq(_col(alice), 5e18);
        assertEq(pool.totalCollateral(), 5e18);
        assertEq(meth.balanceOf(address(pool)), 5e18);
    }

    function test_depositZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(LendingPoolBase.ZeroAmount.selector);
        pool.deposit(0);
    }

    function test_borrowTransfersAndUpdatesTotals() public {
        _open(alice, 10e18, 20_000e18);
        assertEq(musd.balanceOf(alice), 20_000e18);
        assertEq(_debt(alice), 20_000e18);
        assertEq(pool.totalDebt(), 20_000e18);
    }

    function test_borrowBlockedBelowOpenHealth() public {
        _open(alice, 10e18, 0);
        // 10 × 3500 × 0.85 / 21,300 ≈ 1.397 < 1.40
        vm.prank(alice);
        vm.expectRevert();
        pool.borrow(21_300e18);
    }

    function test_repayCapsAtDebt() public {
        _open(alice, 10e18, 20_000e18);
        musd.mint(alice, 1_000e18);
        vm.prank(alice);
        pool.repay(50_000e18);
        assertEq(_debt(alice), 0);
        assertEq(pool.totalDebt(), 0);
        assertEq(musd.balanceOf(alice), 1_000e18);
    }

    function test_withdrawChecksHealth() public {
        _open(alice, 10e18, 20_000e18);
        vm.prank(alice);
        vm.expectRevert();
        pool.withdraw(1e18);

        vm.prank(alice);
        pool.withdraw(0.3e18); // 9.7 × 3500 × 0.85 / 20,000 ≈ 1.443
        assertEq(_col(alice), 9.7e18);
    }

    // ---------- glide ----------

    function test_glideOffAboveComfort() public {
        _open(alice, 10e18, 20_000e18);
        vm.roll(block.number + 10);
        vm.recordLogs();
        vm.prank(keeper);
        bool acted = pool.poke(alice);
        assertFalse(acted);
        assertEq(vm.getRecordedLogs().length, 0, "no events");
        assertEq(_col(alice), 10e18);
        assertEq(_debt(alice), 20_000e18);
    }

    function test_glideSellsSliceAndImprovesHealth() public {
        _open(alice, 10e18, 20_000e18); // H ≈ 1.49
        _setPrice(2_900e18); // H ≈ 1.23
        vm.roll(block.number + 10);

        uint256 hBefore = pool.healthOf(alice);
        vm.expectEmit(true, false, false, false);
        emit SoftLandingPool.Glided(alice, 0, 0, 0, 0, 0);
        assertTrue(pool.poke(alice));

        assertLt(_col(alice), 10e18, "collateral should drop");
        assertLt(_debt(alice), 20_000e18, "debt should drop");
        assertGt(pool.healthOf(alice), hBefore, "health should improve");
        assertLe(pool.healthOf(alice), COMFORT + TOL, "never overshoot comfort");
        assertEq(_lastGlide(alice), block.number);
    }

    function test_glideSliceMatchesAccruedShare() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_900e18);
        uint256 h = pool.healthOf(alice);
        uint256 r = pool.glideRate(h);
        vm.roll(block.number + 1);
        pool.poke(alice);
        assertEq(10e18 - _col(alice), 10e18 * r / 1e18, "1 block sells r");
    }

    function test_blockAccrualGrowsAndCapsAt100() public {
        uint256 sold1 = _soldAfter(1);
        uint256 sold10 = _soldAfter(10);
        uint256 sold100 = _soldAfter(100);
        uint256 sold150 = _soldAfter(150);
        assertGt(sold10, sold1 * 9, "10 blocks ~ 10x one block");
        assertLt(sold10, sold1 * 10 + 1);
        assertEq(sold150, sold100, "accrual capped at N_MAX");
    }

    function _soldAfter(uint256 blocks) internal returns (uint256 sold) {
        uint256 snap = vm.snapshotState();
        _open(alice, 10e18, 20_000e18);
        oracle.setPrice(3_000e18); // H = 1.275 > comfort, small AMM move keeps band
        _setPrice(2_950e18); // H ≈ 1.254 -> just above comfort
        oracle.setPrice(2_900e18); // H ≈ 1.2325, AMM within 2%
        vm.roll(block.number + blocks);
        pool.poke(alice);
        sold = 10e18 - _col(alice);
        vm.revertToState(snap);
    }

    function test_glideNeverSellsMoreThanNeeded() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_700e18); // H ≈ 1.1475; 100 blocks of share would overshoot
        vm.roll(block.number + 100);
        uint256 need = pool.sNeeded(10e18, 20_000e18, 2_700e18);
        pool.poke(alice);
        assertEq(10e18 - _col(alice), need, "capped at s_needed");
        uint256 h = pool.healthOf(alice);
        assertLe(h, COMFORT + TOL);
        assertGt(h, 1.22e18, "lands near comfort (slippage only)");
    }

    function test_selfHealingWhenPriceRecovers() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_900e18);
        vm.roll(block.number + 5);
        pool.poke(alice);
        uint256 cAfterDip = _col(alice);

        _setPrice(3_500e18);
        vm.roll(block.number + 50);
        assertFalse(pool.poke(alice));
        assertEq(_col(alice), cAfterDip, "selling stops, user keeps the rest");
    }

    function test_pokeTwiceInOneBlockActsOnce() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_700e18);
        vm.roll(block.number + 5);
        assertTrue(pool.poke(alice));
        uint256 c = _col(alice);
        for (uint256 i; i < 10; ++i) {
            assertFalse(pool.poke(alice));
        }
        assertEq(_col(alice), c);
    }

    function test_withdrawCannotDodgeGlide() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_900e18);
        vm.roll(block.number + 10);
        vm.prank(alice);
        vm.expectRevert();
        pool.withdraw(0.1e18);
    }

    function test_userActionSettlesGlideFirst() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_900e18);
        vm.roll(block.number + 10);
        meth.mint(alice, 1e18);
        vm.prank(alice);
        pool.deposit(1e18);
        assertLt(_col(alice), 11e18, "glide ran before deposit");
    }

    // ---------- tip ----------

    function test_tipPaidOnlyWhenActed() public {
        _open(alice, 10e18, 20_000e18);
        vm.roll(block.number + 1);
        vm.prank(keeper);
        pool.poke(alice);
        assertEq(musd.balanceOf(keeper), 0, "no tip when idle");

        _setPrice(2_700e18);
        vm.roll(block.number + 100);
        vm.prank(keeper);
        pool.poke(alice); // fee on ~1.9 mETH slice ≈ 5 mUSD ≥ tip
        assertEq(musd.balanceOf(keeper), pool.tip(), "flat tip");
    }

    function test_noTipIfFeesInsufficient() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_900e18);
        vm.roll(block.number + 1);
        vm.prank(keeper);
        assertTrue(pool.poke(alice)); // tiny slice, fee < tip
        assertEq(musd.balanceOf(keeper), 0);
    }

    // ---------- pokeMany ----------

    function test_pokeManyBounded() public {
        address[] memory users = new address[](21);
        vm.expectRevert(SoftLandingPool.TooManyUsers.selector);
        pool.pokeMany(users);
    }

    function test_pokeManyHandlesEachUser() public {
        _open(alice, 10e18, 20_000e18); // will glide
        _open(bob, 10e18, 5_000e18); // stays healthy
        _setPrice(2_900e18);
        vm.roll(block.number + 10);
        address[] memory users = new address[](2);
        users[0] = alice;
        users[1] = bob;
        assertEq(pool.pokeMany(users), 1);
        assertLt(_col(alice), 10e18);
        assertEq(_col(bob), 10e18);
    }

    // ---------- backstop ----------

    function test_backstopRestoresComfortWithoutClosing() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_350e18); // H ≈ 0.999 < floor
        vm.roll(block.number + 1);
        uint256 need = pool.backstopSlice(10e18, 20_000e18, 2_350e18, router.BACKSTOP_SLIP_BPS());
        vm.expectEmit(true, false, false, false);
        emit SoftLandingPool.BackstopLiquidated(alice, 0, 0, 0);
        pool.poke(alice);
        assertEq(10e18 - _col(alice), need, "sells only what restores comfort");
        assertGt(_debt(alice), 0, "position stays open");
        assertGe(pool.healthOf(alice), COMFORT, "back at or above comfort");
        assertLt(pool.healthOf(alice), 1.4e18, "not over-sold");
        assertEq(pool.badDebt(), 0);
    }

    function test_backstopSellsLessThanFullClose() public view {
        uint256 s = pool.backstopSlice(10e18, 20_000e18, 2_350e18, 500);
        uint256 closePrice = 2_350e18 * 95 / 100;
        uint256 fullClose = uint256(20_000e18) * 1e18 / closePrice;
        assertLt(s, fullClose * 80 / 100);
    }

    function test_backstopRecordsBadDebt() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(1_500e18); // gap far below floor
        vm.roll(block.number + 1);
        pool.poke(alice);
        assertEq(_col(alice), 0);
        assertEq(_debt(alice), 0);
        assertGt(pool.badDebt(), 0, "shortfall recorded, never hidden");
        assertEq(pool.totalDebt(), 0);
    }

    // ---------- router skip ----------

    function test_routerSkipKeepsStateAndRetries() public {
        _open(alice, 10e18, 20_000e18);
        oracle.setPrice(2_900e18); // AMM still at 3,500 → 20% off, outside band
        vm.roll(block.number + 10);
        uint256 last = _lastGlide(alice);

        vm.expectEmit(true, false, false, true);
        emit SoftLandingPool.GlideSkipped(alice, "price_band");
        assertFalse(pool.poke(alice));
        assertEq(_col(alice), 10e18);
        assertEq(_lastGlide(alice), last, "lastGlideBlock unchanged so it retries");

        _arbTo(2_900e18);
        assertTrue(pool.poke(alice), "retries once the AMM is back in band");
    }

    function test_ammManipulationCannotForceCheapSale() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_900e18);
        vm.roll(block.number + 10);
        // attacker dumps mETH to push the AMM 5% below oracle, then pokes
        meth.mint(bob, 30e18);
        vm.startPrank(bob);
        meth.approve(address(amm), 30e18);
        amm.swapAForB(30e18, 0, bob);
        pool.poke(alice);
        vm.stopPrank();
        assertEq(_col(alice), 10e18, "victim loses nothing");
    }

    // ---------- oracle failure ----------

    function test_staleOracleBlocksBorrowButNotSafeActions() public {
        _open(alice, 10e18, 10_000e18);
        oracle.setMaxAge(60);
        vm.warp(block.timestamp + 10 minutes);
        vm.roll(block.number + 5);

        uint256 updatedAt = oracle.updatedAt();
        meth.mint(alice, 1e18);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(MockOracle.StalePrice.selector, updatedAt));
        pool.borrow(1e18);

        pool.deposit(1e18); // still works
        pool.repay(1_000e18); // still works
        vm.stopPrank();
        assertEq(_col(alice), 11e18);
        assertEq(_debt(alice), 9_000e18);

        vm.expectRevert();
        pool.poke(alice);
    }

    // ---------- forecast ----------

    function test_previewMatchesActualPath() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_800e18);
        vm.roll(block.number + 1);
        pool.poke(alice); // start from a freshly settled state

        uint256 blocks = 30;
        (uint256[] memory hPath, uint256[] memory cPath) = pool.previewGlide(alice, 0, blocks);
        for (uint256 i; i < blocks; ++i) {
            vm.roll(block.number + 1);
            pool.poke(alice);
            assertApproxEqRel(_col(alice), cPath[i], 1e14, "collateral path within 0.01%");
            assertApproxEqRel(pool.healthOf(alice), hPath[i], 5e15, "health path within 0.5%");
        }
    }

    function test_previewShockShowsGlideThenFlat() public {
        _open(alice, 10e18, 20_000e18);
        (uint256[] memory hPath,) = pool.previewGlide(alice, -2_000, 200); // −20%: H ≈ 1.19
        assertLt(hPath[0], COMFORT);
        assertGt(hPath[199], hPath[0], "health recovers along the path");
        assertLe(hPath[199], COMFORT + TOL);
    }

    function test_previewRangeChecked() public {
        vm.expectRevert(SoftLandingPool.PreviewRange.selector);
        pool.previewGlide(alice, 0, 201);
        vm.expectRevert(SoftLandingPool.PreviewRange.selector);
        pool.previewGlide(alice, -10_000, 10);
    }

    // ---------- maths ----------

    function test_sNeededRestoresComfort() public view {
        uint256 c = 10e18;
        uint256 d = 20_000e18;
        uint256 p = 2_700e18;
        uint256 s = pool.sNeeded(c, d, p);
        uint256 repayAmt = s * p / 1e18 * (1e18 - pool.FEE()) / 1e18;
        uint256 h = (c - s) * p / 1e18 * pool.LT() / (d - repayAmt);
        assertApproxEqAbs(h, COMFORT, 1e12);
    }

    function test_glideRateLinear() public view {
        assertEq(pool.glideRate(1.25e18), 0);
        assertEq(pool.glideRate(1.3e18), 0);
        assertEq(pool.glideRate(1.02e18), pool.R_MAX());
        assertEq(pool.glideRate(1.135e18), pool.R_MAX() / 2);
    }
}
