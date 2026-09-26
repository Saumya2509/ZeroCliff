// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../Base.t.sol";
import {CliffPool} from "../../src/CliffPool.sol";

contract CliffPoolTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _openCliff(alice, 10e18, 20_000e18);
        musd.mint(keeper, 100_000e18);
        vm.prank(keeper);
        musd.approve(address(cliff), type(uint256).max);
    }

    function test_cannotLiquidateHealthy() public {
        oracle.setPrice(2_400e18); // H = 1.02 ≥ 1.0
        vm.prank(keeper);
        vm.expectRevert();
        cliff.liquidate(alice, 10_000e18);
    }

    function test_closeFactorAndBonus() public {
        oracle.setPrice(2_300e18); // H ≈ 0.9775
        vm.prank(keeper);
        uint256 seized = cliff.liquidate(alice, 50_000e18);

        (uint128 c, uint128 d,) = cliff.positions(alice);
        assertEq(d, 10_000e18, "at most 50% of debt repaid");
        assertEq(seized, uint256(10_000e18) * 1.08e18 / 2_300e18, "8% bonus");
        assertEq(c, 10e18 - seized);
        assertEq(meth.balanceOf(keeper), seized);
        assertEq(cliff.totalDebt(), 10_000e18);
        assertEq(cliff.totalCollateral(), c);
    }

    function test_cliffLosesMoreThanGlide() public {
        // Same position, same price path: soft landing keeps more collateral.
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_300e18);
        vm.prank(keeper);
        cliff.liquidate(alice, 50_000e18);
        (uint128 cliffCol,,) = cliff.positions(alice);

        _setPrice(2_700e18); // soft pool has been gliding on the way down in reality; here it sees one poke
        vm.roll(block.number + 100);
        pool.poke(alice);
        assertGt(_col(alice), cliffCol);
    }

    function test_badDebtWhenCollateralExhausted() public {
        oracle.setPrice(1_000e18); // collateral worth 10,000 vs 20,000 debt
        vm.startPrank(keeper);
        cliff.liquidate(alice, 10_000e18); // seizes 10.8 mETH → capped at 10
        vm.stopPrank();
        (uint128 c, uint128 d,) = cliff.positions(alice);
        assertEq(c, 0);
        assertEq(d, 0);
        assertEq(cliff.badDebt(), 10_000e18);
        assertEq(cliff.totalDebt(), 0);
    }
}
