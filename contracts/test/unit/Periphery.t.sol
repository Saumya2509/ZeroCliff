// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../Base.t.sol";
import {MockToken} from "../../src/mocks/MockToken.sol";
import {MockAMM} from "../../src/mocks/MockAMM.sol";
import {PythOracleAdapter} from "../../src/PythOracleAdapter.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

contract MockTokenTest is BaseTest {
    function test_faucetRateLimited() public {
        vm.startPrank(alice);
        meth.faucet();
        assertEq(meth.balanceOf(alice), 10e18);
        vm.expectRevert();
        meth.faucet();
        vm.warp(block.timestamp + 1 hours);
        meth.faucet();
        vm.stopPrank();
        assertEq(meth.balanceOf(alice), 20e18);
    }

    function test_onlyOwnerMints() public {
        vm.prank(alice);
        vm.expectRevert();
        meth.mint(alice, 1);
    }
}

contract MockAMMTest is BaseTest {
    function test_spotPriceMatchesSeed() public view {
        assertEq(amm.spotPrice(), START_PRICE);
    }

    function test_swapGrowsK() public {
        uint256 k0 = amm.reserveA() * amm.reserveB();
        meth.mint(address(this), 5e18);
        amm.swapAForB(5e18, 0, address(this));
        assertGe(amm.reserveA() * amm.reserveB(), k0);
    }

    function test_minOutEnforced() public {
        meth.mint(address(this), 1e18);
        vm.expectRevert();
        amm.swapAForB(1e18, 3_500e18, address(this)); // fee makes this impossible
    }

    function testFuzz_kNeverDecreases(uint96 amountIn, bool aToB) public {
        uint256 amt = bound(amountIn, 1e9, 500e18);
        uint256 k0 = amm.reserveA() * amm.reserveB();
        if (aToB) {
            meth.mint(address(this), amt);
            amm.swapAForB(amt, 0, address(this));
        } else {
            musd.mint(address(this), amt * 3_500);
            amm.swapBForA(amt * 3_500, 0, address(this));
        }
        assertGe(amm.reserveA() * amm.reserveB(), k0);
    }
}

contract SliceRouterTest is BaseTest {
    function setUp() public override {
        super.setUp();
        meth.mint(address(this), 100e18);
        meth.approve(address(router), type(uint256).max);
    }

    function test_sellsInsideBand() public {
        (bool ok, uint256 out) = router.trySell(1e18, START_PRICE, false);
        assertTrue(ok);
        assertGe(out, START_PRICE * (10_000 - router.MAX_SLIP_BPS()) / 10_000);
    }

    function test_skipsOutsideBand() public {
        uint256 bal = meth.balanceOf(address(this));
        (bool ok, uint256 out) = router.trySell(1e18, START_PRICE * 103 / 100, false); // oracle 3% above AMM
        assertFalse(ok);
        assertEq(out, 0);
        assertEq(meth.balanceOf(address(this)), bal, "nothing moved");
    }

    function test_backstopBandIsWider() public {
        uint256 oraclePx = START_PRICE * 104 / 100; // 4% off: outside the normal band, inside backstop
        (bool okNormal,) = router.trySell(1e18, oraclePx, false);
        (bool okBackstop,) = router.trySell(1e18, oraclePx, true);
        assertFalse(okNormal);
        assertTrue(okBackstop);
    }

    function test_skipsWhenSliceTooBig() public {
        (bool ok,) = router.trySell(50e18, START_PRICE, false); // ~5% price impact
        assertFalse(ok);
    }

    function testFuzz_neverBelowMinOut(uint96 amountIn, uint16 offsetBps) public {
        uint256 amt = bound(amountIn, 1e12, 100e18);
        uint256 oraclePx = START_PRICE * (10_000 + bound(offsetBps, 0, 400)) / 10_000;
        uint256 bal = musd.balanceOf(address(this));
        (bool ok, uint256 out) = router.trySell(amt, oraclePx, false);
        if (ok) {
            assertGe(out, amt * oraclePx / 1e18 * (10_000 - router.MAX_SLIP_BPS()) / 10_000);
            assertLe(oraclePx - START_PRICE, START_PRICE * router.BAND_BPS() / 10_000 + 1, "never outside band");
            assertEq(musd.balanceOf(address(this)), bal + out);
        }
    }
}

contract PythOracleAdapterTest is BaseTest {
    bytes32 internal constant FEED = bytes32(uint256(0xE7));
    MockPyth internal pyth;
    PythOracleAdapter internal adapter;

    function setUp() public override {
        super.setUp();
        pyth = new MockPyth(60, 1);
        adapter = new PythOracleAdapter(IPyth(address(pyth)), FEED, 60);
    }

    function _push(int64 price, uint64 conf, int32 expo) internal {
        bytes[] memory upd = new bytes[](1);
        upd[0] = pyth.createPriceFeedUpdateData(FEED, price, conf, expo, price, conf, uint64(block.timestamp));
        adapter.update{value: 1 ether}(upd);
    }

    receive() external payable {}

    function test_convertsToWad() public {
        _push(3_500e8, 1e8, -8);
        (uint256 p, uint256 t) = adapter.getPrice();
        assertEq(p, 3_500e18);
        assertEq(t, block.timestamp);
    }

    function test_refundsExcessFee() public {
        uint256 bal = address(this).balance;
        _push(3_500e8, 1e8, -8);
        assertEq(address(this).balance, bal - 1);
    }

    function test_revertsWhenStale() public {
        _push(3_500e8, 1e8, -8);
        vm.warp(block.timestamp + 61);
        vm.expectRevert();
        adapter.getPrice();
    }

    function test_longerMaxAgeAcceptsOlderPricesButNotBeyondIt() public {
        PythOracleAdapter slow = new PythOracleAdapter(IPyth(address(pyth)), FEED, 600);
        _push(3_500e8, 1e8, -8);
        vm.warp(block.timestamp + 300); // stale for the 60 s adapter, fine for the 600 s one
        vm.expectRevert();
        adapter.getPrice();
        (uint256 p,) = slow.getPrice();
        assertEq(p, 3_500e18);
        vm.warp(block.timestamp + 301); // 601 s old
        vm.expectRevert();
        slow.getPrice();
    }

    function test_rejectsZeroOrHugeMaxAge() public {
        vm.expectRevert(abi.encodeWithSelector(PythOracleAdapter.BadMaxAge.selector, 0));
        new PythOracleAdapter(IPyth(address(pyth)), FEED, 0);
        vm.expectRevert(abi.encodeWithSelector(PythOracleAdapter.BadMaxAge.selector, 30 days + 1));
        new PythOracleAdapter(IPyth(address(pyth)), FEED, 30 days + 1);
    }

    function test_revertsOnWideConfidence() public {
        _push(3_500e8, 36e8, -8); // > 1%
        vm.expectRevert(PythOracleAdapter.WideConfidence.selector);
        adapter.getPrice();
    }

    function test_revertsOnNonPositive() public {
        _push(0, 0, -8);
        vm.expectRevert(PythOracleAdapter.BadPrice.selector);
        adapter.getPrice();
    }

    function test_revertsOnBadExponent() public {
        PythStructs.Price memory p = PythStructs.Price({price: 1, conf: 0, expo: -19, publishTime: 1});
        vm.expectRevert(abi.encodeWithSelector(PythOracleAdapter.BadExponent.selector, int32(-19)));
        adapter.toWad(p);
    }

    function testFuzz_exponentConversion(uint32 raw, uint8 negExp) public view {
        int32 expo = -int32(uint32(bound(negExp, 0, 12)));
        uint256 px = bound(raw, 1, type(uint32).max);
        PythStructs.Price memory p = PythStructs.Price({price: int64(uint64(px)), conf: 0, expo: expo, publishTime: 1});
        (uint256 wad,) = adapter.toWad(p);
        assertEq(wad, px * 10 ** uint256(int256(18) + expo));
    }
}
