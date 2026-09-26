// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BaseTest} from "../Base.t.sol";
import {ISliceRouter} from "../../src/interfaces/ISliceRouter.sol";
import {MockAMM} from "../../src/mocks/MockAMM.sol";
import {MockOracle} from "../../src/mocks/MockOracle.sol";
import {SoftLandingPool} from "../../src/SoftLandingPool.sol";
import {LendingPoolBase} from "../../src/LendingPoolBase.sol";

/// @notice The "before": a router with no oracle band and no minimum output.
contract NaiveRouter is ISliceRouter {
    using SafeERC20 for IERC20;

    MockAMM public immutable amm;

    constructor(MockAMM amm_) {
        amm = amm_;
    }

    function slipBps(bool) external pure returns (uint256) {
        return 10_000;
    }

    function trySell(uint256 amountIn, uint256, bool) external returns (bool, uint256 out) {
        IERC20 t = amm.tokenA();
        t.safeTransferFrom(msg.sender, address(this), amountIn);
        t.forceApprove(address(amm), amountIn);
        out = amm.swapAForB(amountIn, 0, msg.sender);
        return (true, out);
    }
}

/// @notice Collateral token that re-enters the pool from inside transferFrom.
contract HookToken is ERC20 {
    address public target;
    bytes public payload;

    constructor() ERC20("Hook", "HOOK") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function transferFrom(address from, address to, uint256 amt) public override returns (bool) {
        if (target != address(0)) {
            (bool ok, bytes memory ret) = target.call(payload);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
        return super.transferFrom(from, to, amt);
    }
}

contract AttackScenariosTest is BaseTest {
    /// A1 AMM manipulation then poke. Before (naive router): victim sells into the dumped pool.
    /// After (SliceRouter): band check skips, victim loses nothing.
    function test_A1_ammManipulation_beforeAfter() public {
        uint256 lossNaive = _manipulationLoss(true);
        uint256 lossGuarded = _manipulationLoss(false);
        console2.log("A1 victim loss, naive router (mUSD)  ", lossNaive / 1e18);
        console2.log("A1 victim loss, slice router (mUSD)  ", lossGuarded / 1e18);
        assertGt(lossNaive, 0, "naive router lets the attacker force a cheap sale");
        assertEq(lossGuarded, 0, "band check protects the victim");
    }

    function _manipulationLoss(bool naive) internal returns (uint256 loss) {
        uint256 snap = vm.snapshotState();
        if (naive) pool.setRouter(new NaiveRouter(amm));
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_900e18);
        vm.roll(block.number + 100);

        // attacker dumps 150 mETH (~25% below oracle) then pokes the victim
        meth.mint(bob, 150e18);
        vm.startPrank(bob);
        meth.approve(address(amm), type(uint256).max);
        amm.swapAForB(150e18, 0, bob);
        (uint128 c0, uint128 d0,) = pool.positions(alice);
        pool.poke(alice);
        vm.stopPrank();
        (uint128 c1, uint128 d1,) = pool.positions(alice);
        // loss = collateral given up at oracle value − debt it repaid
        uint256 given = uint256(c0 - c1) * 2_900e18 / 1e18;
        uint256 repaid = d0 - d1;
        loss = given > repaid ? given - repaid : 0;
        vm.revertToState(snap);
    }

    /// A2 Stale oracle: borrowing reverts.
    function test_A2_staleOracleBlocksBorrow() public {
        _open(alice, 10e18, 0);
        oracle.setMaxAge(60);
        vm.warp(block.timestamp + 10 minutes);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MockOracle.StalePrice.selector, oracle.updatedAt()));
        pool.borrow(1_000e18);
    }

    /// A3 Withdraw to dodge glide: the glide runs first, then the health check blocks the withdraw.
    function test_A3_withdrawCannotDodgeGlide() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_900e18);
        vm.roll(block.number + 10);
        vm.prank(alice);
        vm.expectRevert();
        pool.withdraw(0.01e18);
        // and the pending glide still happens on the next poke
        assertTrue(pool.poke(alice));
    }

    /// A4 Poke spam for tips: 100 pokes in one block pay one tip.
    function test_A4_pokeSpamPaysOneTip() public {
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_700e18);
        vm.roll(block.number + 100);
        vm.startPrank(keeper);
        for (uint256 i; i < 100; ++i) {
            pool.poke(alice);
        }
        vm.stopPrank();
        assertEq(musd.balanceOf(keeper), pool.tip());
    }

    /// A5 Reentrancy via a token hook: blocked by nonReentrant.
    function test_A5_reentrancyBlocked() public {
        HookToken hook = new HookToken();
        SoftLandingPool hooked = new SoftLandingPool(IERC20(address(hook)), musd, oracle, router);
        hook.mint(alice, 10e18);
        vm.prank(alice);
        hook.approve(address(hooked), type(uint256).max);
        hook.arm(address(hooked), abi.encodeCall(LendingPoolBase.withdraw, (1)));
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        hooked.deposit(10e18);
    }

    /// A6 Oracle jump past the floor (−40% in one update): backstop runs, shortfall (if any) is
    /// recorded as bad debt, totals and solvency still hold.
    function test_A6_oracleJumpPastFloor() public {
        _open(alice, 10e18, 20_000e18);
        _open(bob, 10e18, 15_000e18);
        _setPrice(2_100e18); // alice H ≈ 0.89 (backstop), bob H ≈ 1.19 (glide band)
        vm.roll(block.number + 1);
        vm.expectEmit(true, false, false, false);
        emit SoftLandingPool.BackstopLiquidated(alice, 0, 0, 0);
        pool.poke(alice);
        pool.poke(bob);
        (uint128 ca, uint128 da,) = pool.positions(alice);
        (uint128 cb, uint128 db,) = pool.positions(bob);
        assertEq(pool.totalCollateral(), uint256(ca) + cb);
        assertEq(pool.totalDebt(), uint256(da) + db);
        assertGe(musd.balanceOf(address(pool)) + pool.totalDebt() + pool.badDebt(), pool.totalFunded());
        assertGe(meth.balanceOf(address(pool)), pool.totalCollateral());
        if (da > 0) assertGe(pool.healthOf(alice), 1.25e18);
        // alice's backstop sale can push the AMM out of the 2% band, so bob's slice may skip until arbitrage
        assertGe(pool.healthOf(bob), 1.19e18, "bob never worse");
        assertGt(db, 0);
    }

    /// A7 Rounding dust: 10,000 tiny deposits and withdrawals leave totals exact and give nothing away.
    function test_A7_roundingDust() public {
        meth.mint(alice, 10_000);
        vm.startPrank(alice);
        meth.approve(address(pool), type(uint256).max);
        for (uint256 i; i < 10_000; ++i) {
            pool.deposit(1);
            pool.withdraw(1);
        }
        vm.stopPrank();
        assertEq(pool.totalCollateral(), 0);
        assertEq(meth.balanceOf(alice), 10_000);
        assertEq(meth.balanceOf(address(pool)), 0);
    }
}
