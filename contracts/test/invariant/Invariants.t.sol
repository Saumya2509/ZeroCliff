// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console2} from "forge-std/console2.sol";
import {BaseTest} from "../Base.t.sol";
import {Handler} from "./Handler.sol";

/// @notice I1–I7 from 03-testing-and-security.md, checked after every handler call.
contract InvariantsTest is BaseTest {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(pool, cliff, oracle, amm, meth, musd);
        meth.transferOwnership(address(handler));
        musd.transferOwnership(address(handler));
        oracle.transferOwnership(address(handler));
        amm.transferOwnership(address(handler));
        handler.init();
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = Handler.deposit.selector;
        selectors[1] = Handler.borrow.selector;
        selectors[2] = Handler.repay.selector;
        selectors[3] = Handler.withdraw.selector;
        selectors[4] = Handler.movePrice.selector;
        selectors[5] = Handler.rollBlocks.selector;
        selectors[6] = Handler.crash.selector;
        selectors[7] = Handler.selloff.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function _all() internal view returns (address[] memory users) {
        (uint256 m, uint256 f) = handler.actorsLength();
        users = new address[](m + f);
        for (uint256 i; i < m; ++i) {
            users[i] = handler.mirrored(i);
        }
        for (uint256 i; i < f; ++i) {
            users[m + i] = handler.free(i);
        }
    }

    /// I1 Solvency: mUSD held + debt outstanding covers lender funds minus recorded bad debt.
    function invariant_I1_solvency() public view {
        assertGe(musd.balanceOf(address(pool)) + pool.totalDebt() + pool.badDebt(), pool.totalFunded());
    }

    /// I2 totalCollateral equals the sum of positions.
    function invariant_I2_totalCollateral() public view {
        address[] memory u = _all();
        uint256 sum;
        for (uint256 i; i < u.length; ++i) {
            (uint128 c,,) = pool.positions(u[i]);
            sum += c;
        }
        assertEq(pool.totalCollateral(), sum);
    }

    /// I3 totalDebt equals the sum of positions.
    function invariant_I3_totalDebt() public view {
        address[] memory u = _all();
        uint256 sum;
        for (uint256 i; i < u.length; ++i) {
            (, uint128 d,) = pool.positions(u[i]);
            sum += d;
        }
        assertEq(pool.totalDebt(), sum);
    }

    /// I4 No overshoot: a glided user never ends above comfort + tolerance.
    function invariant_I4_noOvershoot() public view {
        assertFalse(handler.overshoot());
    }

    /// I5 No unwind when starting health is at or above comfort.
    function invariant_I5_noGlideAboveComfort() public view {
        assertFalse(handler.glidedAboveComfort());
    }

    /// I6 The pool holds at least the collateral it owes users.
    function invariant_I6_tokenBalance() public view {
        assertGe(meth.balanceOf(address(pool)), pool.totalCollateral());
    }

    /// I7 Glide dominates cliff (when no backstop fired): for mirrored positions under the same price path,
    ///    once the ghost has been liquidated, the value Soft Landing took from the user to unwind (fees +
    ///    slippage, at the oracle price) is no more than what the cliff took (its liquidation bonus).
    ///    Backstopped positions are excluded: back-to-back gaps can make backstop execution cost about
    ///    equal to the cliff bonus (see docs/security.md, "Known limits").
    function invariant_I7_glideDominatesCliff() public view {
        (uint256 m,) = handler.actorsLength();
        for (uint256 i; i < m; ++i) {
            address a = handler.mirrored(i);
            if (!handler.cliffLiquidated(a) || handler.backstopped(a) || handler.hadBadDebt(a)) continue;
            assertLe(handler.softLoss(a), handler.cliffLoss(a), "soft landing loses less than the cliff");
        }
    }

    /// @dev Coverage check: prints how often the interesting paths were reached.
    function afterInvariant() public view {
        console2.log("calls", handler.calls());
        console2.log("glides", handler.glides());
        console2.log("backstops", handler.backstops());
        console2.log("cliff liquidations", handler.liquidations());
        console2.log("I7 rounds compared", handler.i7Rounds());
    }
}
