// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console2} from "forge-std/console2.sol";
import {BaseTest} from "../Base.t.sol";

/// @notice Replays a stylised crash path (−45% over ~1 hour of 2 s blocks, partial recovery) through both
///         pools with a keeper acting every block. Illustrative shape only; real historical replays live in
///         the simulator (05) with sourced price data.
contract CrashScenarioTest is BaseTest {
    uint256 internal constant BLOCKS_PER_STEP = 60; // 2 minutes of 2 s blocks per price step

    function _path() internal pure returns (uint256[24] memory p) {
        p = [
            uint256(3_500),
            3_420,
            3_300,
            3_150,
            3_050,
            2_900,
            2_800,
            2_650,
            2_500,
            2_380,
            2_250,
            2_150,
            2_050,
            1_950,
            1_925,
            2_000,
            2_150,
            2_300,
            2_450,
            2_550,
            2_650,
            2_700,
            2_750,
            2_800
        ];
    }

    function test_crashReplay_glideKeepsMoreThanCliff() public {
        address[3] memory users = [alice, bob, makeAddr("carol")];
        uint256[3] memory debts = [uint256(20_000e18), 19_000e18, 18_000e18];
        for (uint256 i; i < 3; ++i) {
            _open(users[i], 10e18, debts[i]);
            _openCliff(users[i], 10e18, debts[i]);
        }
        musd.mint(keeper, 1_000_000e18);
        vm.prank(keeper);
        musd.approve(address(cliff), type(uint256).max);

        uint256[24] memory path = _path();
        for (uint256 s; s < path.length; ++s) {
            uint256 target = path[s] * 1e18;
            for (uint256 b; b < BLOCKS_PER_STEP; ++b) {
                vm.roll(block.number + 1);
                if (b == 0) _setPrice(target);
                for (uint256 i; i < 3; ++i) {
                    vm.startPrank(keeper);
                    pool.poke(users[i]);
                    if (cliff.healthOf(users[i]) < 1e18) {
                        (, uint128 d,) = cliff.positions(users[i]);
                        cliff.liquidate(users[i], d);
                    }
                    vm.stopPrank();
                }
            }
        }

        uint256 endPrice = path[path.length - 1] * 1e18;
        for (uint256 i; i < 3; ++i) {
            (uint128 cs, uint128 ds,) = pool.positions(users[i]);
            (uint128 cc, uint128 dc,) = cliff.positions(users[i]);
            uint256 eqSoft = uint256(cs) * endPrice / 1e18 - ds;
            uint256 eqCliff = uint256(cc) * endPrice / 1e18 - dc;
            console2.log("user", i);
            console2.log("  soft  equity (mUSD)", eqSoft / 1e18);
            console2.log("  cliff equity (mUSD)", eqCliff / 1e18);
            assertGt(eqSoft, eqCliff, "soft landing leaves the user better off");
        }
        assertEq(pool.badDebt(), 0, "no bad debt in the soft pool");
    }
}
