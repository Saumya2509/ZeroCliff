// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../Base.t.sol";

/// @notice Exports vectors from the REAL contracts for the crash simulator (05), which must reproduce
///         each exactly: MockAMM quotes, SliceRouter sell/skip decisions, CliffPool liquidations and
///         full SoftLandingPool pokes (glide or backstop, AMM sale, fee, refund, bad debt).
///         Writes vectors/engine.json. All integers are decimal strings.
contract ExportEngineVectorsTest is BaseTest {
    uint256 internal constant N = 25;
    address internal liq;

    function _rand(string memory tag, uint256 i, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return lo + uint256(keccak256(abi.encode(tag, i))) % (hi - lo + 1);
    }

    function test_exportEngineVectors() public {
        meth.mint(address(this), 10_000e18);
        meth.approve(address(router), type(uint256).max);
        liq = makeAddr("vector-liquidator");
        musd.mint(liq, 10_000_000e18);
        vm.prank(liq);
        musd.approve(address(cliff), type(uint256).max);

        string[4] memory parts;
        string[] memory items = new string[](N);
        for (uint256 i; i < N; ++i) items[i] = _ammItem(i);
        parts[0] = _join(items);
        for (uint256 i; i < N; ++i) items[i] = _routerItem(i);
        parts[1] = _join(items);
        for (uint256 i; i < N; ++i) items[i] = _cliffItem(i);
        parts[2] = _join(items);
        for (uint256 i; i < N; ++i) items[i] = _pokeItem(i);
        parts[3] = _join(items);

        vm.writeFile(
            "./vectors/engine.json",
            string.concat('{"amm":', parts[0], ',"router":', parts[1], ',"cliff":', parts[2], ',"poke":', parts[3], "}")
        );
    }

    // ---------- MockAMM.getAmountOut ----------
    function _ammItem(uint256 i) internal returns (string memory) {
        uint256 rIn = _rand("amm-rin", i, 1e18, 5_000_000e18);
        uint256 rOut = _rand("amm-rout", i, 1e18, 5_000_000e18);
        uint256 amountIn = _rand("amm-in", i, 1, rIn / 2);
        string memory o = string.concat("amm", vm.toString(i));
        vm.serializeString(o, "amountIn", vm.toString(amountIn));
        vm.serializeString(o, "rIn", vm.toString(rIn));
        vm.serializeString(o, "rOut", vm.toString(rOut));
        return vm.serializeString(o, "out", vm.toString(amm.getAmountOut(amountIn, rIn, rOut)));
    }

    // ---------- SliceRouter.trySell ----------
    function _routerItem(uint256 i) internal returns (string memory json) {
        uint256 snap = vm.snapshotState();
        _arbTo(_rand("rt-amm", i, 2_800, 4_200) * 1e18);
        string memory o = string.concat("rt", vm.toString(i));
        vm.serializeString(o, "reserveA", vm.toString(amm.reserveA()));
        vm.serializeString(o, "reserveB", vm.toString(amm.reserveB()));
        // oracle up to ±12% away from the AMM spot
        uint256 oraclePx = (amm.reserveB() * 1e18 / amm.reserveA()) * _rand("rt-off", i, 8_800, 11_200) / 10_000;
        uint256 amountIn = _rand("rt-in", i, 1e15, 60e18);
        bool backstop = i % 3 == 0;
        vm.serializeString(o, "amountIn", vm.toString(amountIn));
        vm.serializeString(o, "oraclePrice", vm.toString(oraclePx));
        vm.serializeBool(o, "backstop", backstop);
        (bool ok, uint256 out) = router.trySell(amountIn, oraclePx, backstop);
        vm.serializeBool(o, "ok", ok);
        vm.serializeString(o, "out", vm.toString(out));
        vm.serializeString(o, "reserveAAfter", vm.toString(amm.reserveA()));
        json = vm.serializeString(o, "reserveBAfter", vm.toString(amm.reserveB()));
        vm.revertToState(snap);
    }

    // ---------- CliffPool.liquidate ----------
    function _cliffItem(uint256 i) internal returns (string memory json) {
        uint256 snap = vm.snapshotState();
        address u = makeAddr(string.concat("cl", vm.toString(i)));
        uint256 c = _rand("cl-c", i, 1e17, 200e18);
        uint256 d = c * 3_500 * 85 / 145; // opening health 1.45 at 3,500
        _openCliff(u, c, d);
        // price for a target health between 0.55 and 0.99
        uint256 p = _rand("cl-h", i, 55, 99) * d * 1e18 / (c * 85 / 100) / 100;
        oracle.setPrice(p);
        uint256 repay = i % 2 == 0 ? d : _rand("cl-r", i, 1, d);
        string memory o = string.concat("cl", vm.toString(i));
        vm.serializeString(o, "collateral", vm.toString(c));
        vm.serializeString(o, "debt", vm.toString(d));
        vm.serializeString(o, "price", vm.toString(p));
        vm.serializeString(o, "repayAmount", vm.toString(repay));
        vm.prank(liq);
        vm.serializeString(o, "seized", vm.toString(cliff.liquidate(u, repay)));
        (uint128 c1, uint128 d1,) = cliff.positions(u);
        vm.serializeString(o, "collateralAfter", vm.toString(c1));
        vm.serializeString(o, "debtAfter", vm.toString(d1));
        json = vm.serializeString(o, "badDebt", vm.toString(cliff.badDebt()));
        vm.revertToState(snap);
    }

    // ---------- SoftLandingPool.poke (glide or backstop, through the real router and AMM) ----------
    function _pokeItem(uint256 i) internal returns (string memory json) {
        uint256 snap = vm.snapshotState();
        address u = makeAddr(string.concat("pk", vm.toString(i)));
        string memory o = string.concat("pk", vm.toString(i));
        _pokeSetup(i, u, o);
        uint256 feesBefore = pool.protocolFees();
        uint256 balBefore = musd.balanceOf(u);
        vm.serializeBool(o, "acted", pool.poke(u));
        (uint128 c1, uint128 d1, uint64 last) = pool.positions(u);
        vm.serializeBool(o, "lastGlideUpdated", last == block.number);
        vm.serializeString(o, "collateralAfter", vm.toString(c1));
        vm.serializeString(o, "debtAfter", vm.toString(d1));
        vm.serializeString(o, "reserveAAfter", vm.toString(amm.reserveA()));
        vm.serializeString(o, "reserveBAfter", vm.toString(amm.reserveB()));
        vm.serializeString(o, "feeTaken", vm.toString(pool.protocolFees() - feesBefore));
        vm.serializeString(o, "refund", vm.toString(musd.balanceOf(u) - balBefore));
        json = vm.serializeString(o, "badDebt", vm.toString(pool.badDebt()));
        vm.revertToState(snap);
    }

    function _pokeSetup(uint256 i, address u, string memory o) internal {
        uint256 c = _rand("pk-c", i, 1e17, 60e18);
        uint256 d = c * 3_500 * 85 / 145;
        _open(u, c, d);
        // target health from 0.80 to 1.30: covers backstop, glide and idle
        uint256 p = (80 + (50 * i) / (N - 1)) * d * 1e18 / (c * 85 / 100) / 100;
        oracle.setPrice(p);
        _arbTo(p);
        // occasionally knock the AMM out of band to exercise the skip path
        if (i % 7 == 3) amm.swapAForB(80e18, 0, address(this));
        uint256 blocks = _rand("pk-n", i, 1, 150);
        vm.roll(block.number + blocks);
        vm.serializeString(o, "collateral", vm.toString(c));
        vm.serializeString(o, "debt", vm.toString(d));
        vm.serializeString(o, "price", vm.toString(p));
        vm.serializeString(o, "blocks", vm.toString(blocks));
        vm.serializeString(o, "reserveA", vm.toString(amm.reserveA()));
        vm.serializeString(o, "reserveB", vm.toString(amm.reserveB()));
    }

    /// @dev vm.serialize* can't nest arrays of objects, so build the JSON array by hand.
    function _join(string[] memory items) internal pure returns (string memory s) {
        s = "[";
        for (uint256 i; i < items.length; ++i) {
            s = string.concat(s, i == 0 ? "" : ",", items[i]);
        }
        s = string.concat(s, "]");
    }
}
