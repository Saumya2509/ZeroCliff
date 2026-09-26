// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockToken} from "../../src/mocks/MockToken.sol";
import {MockOracle} from "../../src/mocks/MockOracle.sol";
import {MockAMM} from "../../src/mocks/MockAMM.sol";
import {SoftLandingPool} from "../../src/SoftLandingPool.sol";
import {CliffPool} from "../../src/CliffPool.sol";

/// @notice Drives random action sequences. Two kinds of actors:
///  - "mirrored" actors hold identical positions in both pools and only experience price/time (for I7);
///  - "free" actors deposit/borrow/repay/withdraw on the soft pool at random (for I1–I6).
/// A keeper pokes and liquidates every block, like the real bot.
contract Handler is Test {
    uint256 internal constant COMFORT = 1.25e18;
    uint256 internal constant TOL = 1e15;

    SoftLandingPool public pool;
    CliffPool public cliff;
    MockOracle public oracle;
    MockAMM public amm;
    MockToken public meth;
    MockToken public musd;

    address[] public mirrored;
    address[] public free;
    address public keeper = makeAddr("inv-keeper");

    // ghost variables
    bool public overshoot; // I4
    bool public glidedAboveComfort; // I5
    mapping(address => bool) public backstopped;
    mapping(address => bool) public cliffLiquidated;
    /// @dev Value lost to the unwind mechanism, at the oracle price at execution:
    ///      collateral value removed − debt removed − mUSD refunded to the user.
    mapping(address => int256) public softLoss;
    mapping(address => int256) public cliffLoss;
    /// @dev Either pool wrote off debt for this actor: the gap was beyond any mechanism, so I7 skips it.
    mapping(address => bool) public hadBadDebt;
    uint256 public calls;
    uint256 public glides;
    uint256 public backstops;
    uint256 public liquidations;
    uint256 public i7Rounds; // keeper rounds after which I7 compared at least one actor

    constructor(
        SoftLandingPool pool_,
        CliffPool cliff_,
        MockOracle oracle_,
        MockAMM amm_,
        MockToken meth_,
        MockToken musd_
    ) {
        pool = pool_;
        cliff = cliff_;
        oracle = oracle_;
        amm = amm_;
        meth = meth_;
        musd = musd_;
    }

    /// @dev Called once the handler owns the tokens and oracle.
    function init() external {
        require(mirrored.length == 0, "init");
        meth.approve(address(amm), type(uint256).max);
        musd.approve(address(amm), type(uint256).max);
        vm.prank(keeper);
        musd.approve(address(cliff), type(uint256).max);
        musd.mint(keeper, 100_000_000e18);

        for (uint256 i; i < 3; ++i) {
            address a = makeAddr(string.concat("mirror", vm.toString(i)));
            mirrored.push(a);
            uint256 c = (i + 1) * 5e18;
            uint256 d = c * 3_500 * 85 / 100 / (140 + 5 * i) * 100; // H between 1.40 and 1.50
            _openBoth(a, c, d);
        }
        for (uint256 i; i < 2; ++i) {
            address a = makeAddr(string.concat("free", vm.toString(i)));
            free.push(a);
            vm.startPrank(a);
            meth.approve(address(pool), type(uint256).max);
            musd.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _openBoth(address a, uint256 c, uint256 d) internal {
        meth.mint(a, 2 * c);
        vm.startPrank(a);
        meth.approve(address(pool), type(uint256).max);
        meth.approve(address(cliff), type(uint256).max);
        pool.deposit(c);
        pool.borrow(d);
        cliff.deposit(c);
        cliff.borrow(d);
        vm.stopPrank();
    }

    /// @dev Mirrored actors I7 actually compares (ghost liquidated, soft never backstopped, no bad debt).
    function i7Compared() external view returns (uint256 n) {
        for (uint256 i; i < mirrored.length; ++i) {
            if (cliffLiquidated[mirrored[i]] && !backstopped[mirrored[i]] && !hadBadDebt[mirrored[i]]) ++n;
        }
    }

    function actorsLength() external view returns (uint256, uint256) {
        return (mirrored.length, free.length);
    }

    // ---------- free-actor actions ----------

    function deposit(uint256 seed, uint256 amt) external {
        address a = free[seed % free.length];
        amt = bound(amt, 1, 50e18);
        meth.mint(a, amt);
        vm.prank(a);
        pool.deposit(amt);
        _tick();
    }

    function borrow(uint256 seed, uint256 amt) external {
        address a = free[seed % free.length];
        (uint128 c, uint128 d,) = pool.positions(a);
        (uint256 p,) = oracle.getPrice();
        uint256 maxDebt = uint256(c) * p / 1e18 * 0.85e18 / 1.41e18;
        if (maxDebt <= d) return;
        amt = bound(amt, 1, maxDebt - d);
        vm.prank(a);
        try pool.borrow(amt) {} catch {}
        _tick();
    }

    function repay(uint256 seed, uint256 amt) external {
        address a = free[seed % free.length];
        (, uint128 d,) = pool.positions(a);
        if (d == 0) return;
        amt = bound(amt, 1, d);
        musd.mint(a, amt);
        vm.prank(a);
        pool.repay(amt);
        _tick();
    }

    function withdraw(uint256 seed, uint256 amt) external {
        address a = free[seed % free.length];
        (uint128 c,,) = pool.positions(a);
        if (c == 0) return;
        amt = bound(amt, 1, c);
        vm.prank(a);
        try pool.withdraw(amt) {} catch {}
        _tick();
    }

    // ---------- market actions ----------

    function movePrice(int256 bps) external {
        bps = bound(bps, -300, 300); // ±3% per 2 s block is already violent; gaps come from crash()
        uint256 p = oracle.price() * uint256(10_000 + bps) / 10_000;
        p = bound(p, 1_500e18, 10_000e18);
        oracle.setPrice(p);
        _arbTo(p);
        _tick();
    }

    /// @dev Sustained sell-off at a pace the glide is designed for: each step drops 0.5–2%, then 10 blocks
    ///      pass before the keeper acts (0.05–0.2% per block). Up to 20 steps (−10% to −33%).
    function selloff(uint256 bpsPerStep, uint256 steps) external {
        bpsPerStep = bound(bpsPerStep, 50, 200);
        steps = bound(steps, 1, 20);
        for (uint256 i; i < steps; ++i) {
            uint256 p = oracle.price() * (10_000 - bpsPerStep) / 10_000;
            if (p < 1_500e18) break;
            oracle.setPrice(p);
            _arbTo(p);
            vm.roll(block.number + 9);
            _tick();
        }
    }

    /// @dev Sudden gap: −15% to −30% in one update (the case glide can't fully absorb).
    ///      Fires on 1 in 5 calls so runs also explore gradual paths (a gap backstops every actor).
    function crash(uint256 bps) external {
        if (bps % 5 != 0) return;
        bps = bound(bps, 1_500, 3_000);
        uint256 p = oracle.price() * (10_000 - bps) / 10_000;
        if (p < 1_500e18) return;
        oracle.setPrice(p);
        _arbTo(p);
        _tick();
    }

    function rollBlocks(uint256 n) external {
        n = bound(n, 1, 20);
        for (uint256 i; i < n; ++i) {
            vm.roll(block.number + 1);
            _keeperRound();
        }
        calls++;
    }

    function _tick() internal {
        vm.roll(block.number + 1);
        _keeperRound();
        calls++;
    }

    /// @dev What the keeper does every block: poke everyone, liquidate unhealthy ghosts.
    function _keeperRound() internal {
        (uint256 price,) = oracle.getPrice();
        for (uint256 i; i < mirrored.length; ++i) {
            _poke(mirrored[i], price);
            _liquidate(mirrored[i]);
        }
        for (uint256 i; i < free.length; ++i) {
            _poke(free[i], price);
        }
        if (this.i7Compared() > 0) i7Rounds++;
    }

    function _poke(address a, uint256 price) internal {
        (uint128 c0, uint128 d0,) = pool.positions(a);
        uint256 hBefore = d0 == 0 ? type(uint256).max : uint256(c0) * price / 1e18 * 0.85e18 / d0;
        uint256 badBefore = pool.badDebt();
        uint256 balBefore = musd.balanceOf(a);
        vm.prank(keeper);
        bool acted = pool.poke(a);
        if (!acted) return;
        (uint128 c1, uint128 d1,) = pool.positions(a);
        softLoss[a] += int256(uint256(c0 - c1) * price / 1e18) - int256(uint256(d0 - d1))
        - int256(musd.balanceOf(a) - balBefore);
        if (hBefore >= COMFORT) glidedAboveComfort = true;
        if (pool.badDebt() != badBefore) hadBadDebt[a] = true;
        if (hBefore < pool.H_FLOOR() || pool.badDebt() != badBefore) {
            backstopped[a] = true;
            backstops++;
            return;
        }
        glides++;
        if (pool.healthOf(a) > COMFORT + TOL) overshoot = true;
    }

    function _liquidate(address a) internal {
        if (cliff.healthOf(a) >= 1e18) return;
        (uint128 c0, uint128 d,) = cliff.positions(a);
        (uint256 price,) = oracle.getPrice();
        uint256 cliffBadBefore = cliff.badDebt();
        vm.prank(keeper);
        try cliff.liquidate(a, d) {
            if (cliff.badDebt() != cliffBadBefore) hadBadDebt[a] = true;
            (uint128 c1, uint128 d1,) = cliff.positions(a);
            cliffLoss[a] += int256(uint256(c0 - c1) * price / 1e18) - int256(uint256(d - d1));
            cliffLiquidated[a] = true;
            liquidations++;
        } catch {}
    }

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
            uint256 amtIn = (k / targetA - rB) * 10_000 / (10_000 - amm.FEE_BPS());
            musd.mint(address(this), amtIn);
            amm.swapBForA(amtIn, 0, address(this));
        }
    }
}
