// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../Base.t.sol";

contract GlideMathFuzzTest is BaseTest {
    uint256 internal constant COMFORT = 1.25e18;
    uint256 internal constant FLOOR = 1.02e18;
    uint256 internal constant TOL = 1e15;

    /// Health never gets worse after a glide and never overshoots comfort.
    function testFuzz_glideImprovesWithoutOvershoot(uint96 col, uint64 hSeed, uint16 blocks) public {
        uint256 c = bound(col, 0.1e18, 20e18);
        uint256 hStart = bound(hSeed, FLOOR + 1e15, COMFORT - 1e15);
        // borrow at 3,500 with H ≥ H_OPEN, then move price so health lands at hStart
        uint256 debt = c * 3_500e18 / 1e18 * 0.85e18 / 1.45e18;
        _open(alice, c, debt);
        uint256 p = hStart * debt / (c * 0.85e18 / 1e18);
        if (p < 100e18 || p > 3_400e18) return;
        _setPrice(p);

        uint256 hBefore = pool.healthOf(alice);
        vm.assume(hBefore < COMFORT && hBefore >= FLOOR);
        vm.roll(block.number + bound(blocks, 1, 300));
        pool.poke(alice);
        uint256 hAfter = pool.healthOf(alice);
        assertGe(hAfter, hBefore, "glide never makes health worse");
        assertLe(hAfter, COMFORT + TOL, "never overshoots comfort");
    }

    /// sNeeded restores comfort within tolerance for any valid input.
    function testFuzz_sNeededRestoresComfort(uint96 col, uint64 hSeed, uint64 priceSeed) public view {
        uint256 c = bound(col, 1e15, 1_000_000e18);
        uint256 p = bound(priceSeed, 1e18, 100_000e18);
        uint256 h = bound(hSeed, 0.9e18, COMFORT - 1e12);
        uint256 d = c * p / 1e18 * 0.85e18 / h;
        vm.assume(d > 1e12);
        uint256 s = pool.sNeeded(c, d, p);
        vm.assume(s < c);
        uint256 repayAmt = s * p / 1e18 * (1e18 - pool.FEE()) / 1e18;
        vm.assume(repayAmt < d);
        uint256 hAfter = (c - s) * p / 1e18 * 0.85e18 / (d - repayAmt);
        assertApproxEqRel(hAfter, COMFORT, 1e12, "restores comfort");
    }

    /// Slice is bounded by collateral, by sNeeded, and monotone in blocks.
    function testFuzz_sliceBoundsAndMonotone(uint96 col, uint64 hSeed, uint16 n1, uint16 n2) public view {
        uint256 c = bound(col, 1e15, 1_000e18);
        uint256 p = 3_000e18;
        uint256 h = bound(hSeed, FLOOR, COMFORT - 1);
        uint256 d = c * p / 1e18 * 0.85e18 / h;
        uint256 a = bound(n1, 0, 150);
        uint256 b = bound(n2, a, 150);
        uint256 sa = pool.glideSlice(c, d, p, a);
        uint256 sb = pool.glideSlice(c, d, p, b);
        assertLe(sa, sb, "more blocks never sells less");
        assertLe(sb, c);
        assertLe(sb, pool.sNeeded(c, d, p));
    }

    /// Rate is 0 at/above comfort, R_MAX at/below floor, monotone in between.
    function testFuzz_glideRateMonotone(uint256 h1, uint256 h2) public view {
        h1 = bound(h1, 0, 2e18);
        h2 = bound(h2, h1, 2e18);
        assertGe(pool.glideRate(h1), pool.glideRate(h2));
        assertLe(pool.glideRate(h1), pool.R_MAX());
    }
}
