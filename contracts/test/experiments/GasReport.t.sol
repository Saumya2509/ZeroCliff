// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {console2} from "forge-std/console2.sol";
import {BaseTest} from "../Base.t.sol";

/// @notice Measures the gas figures quoted in the deck. Writes results/gas.json only when WRITE_GAS=1, so
///         instrumented runs (coverage, gas reports) can't overwrite the real numbers:
///         WRITE_GAS=1 forge test --mc GasReportTest --isolate
contract GasReportTest is BaseTest {
    function test_gasReport() public {
        // poke with 1 block accrued (glide acts)
        _open(alice, 10e18, 20_000e18);
        _setPrice(2_900e18);
        vm.roll(block.number + 1);
        uint256 g = gasleft();
        pool.poke(alice);
        uint256 poke1 = g - gasleft();

        // poke with 100 blocks accrued (loop runs 100 times)
        vm.roll(block.number + 100);
        g = gasleft();
        pool.poke(alice);
        uint256 poke100 = g - gasleft();

        // idle poke (healthy user, nothing to do)
        _open(bob, 10e18, 5_000e18);
        vm.roll(block.number + 1);
        g = gasleft();
        pool.poke(bob);
        uint256 pokeIdle = g - gasleft();

        // pokeMany(20), every user gliding
        _setPrice(3_500e18);
        address[] memory users = new address[](20);
        for (uint256 i; i < 20; ++i) {
            users[i] = makeAddr(string.concat("u", vm.toString(i)));
            _open(users[i], 1e18, 2_000e18); // H ≈ 1.49 at 3,500
        }
        _setPrice(2_700e18);
        vm.roll(block.number + 1);
        g = gasleft();
        uint256 acted = pool.pokeMany(users);
        uint256 pokeMany20 = g - gasleft();
        assertEq(acted, 20);

        // borrow
        _setPrice(3_500e18);
        address carol = makeAddr("carol");
        _open(carol, 10e18, 0);
        vm.prank(carol);
        g = gasleft();
        pool.borrow(10_000e18);
        uint256 borrowGas = g - gasleft();

        // CliffPool.liquidate
        _openCliff(carol, 10e18, 20_000e18);
        oracle.setPrice(2_300e18);
        musd.mint(keeper, 20_000e18);
        vm.startPrank(keeper);
        musd.approve(address(cliff), type(uint256).max);
        g = gasleft();
        cliff.liquidate(carol, 10_000e18);
        uint256 liquidateGas = g - gasleft();
        vm.stopPrank();

        string memory o = "gas";
        vm.serializeUint(o, "poke_1_block", poke1);
        vm.serializeUint(o, "poke_100_blocks", poke100);
        vm.serializeUint(o, "poke_idle", pokeIdle);
        vm.serializeUint(o, "pokeMany_20", pokeMany20);
        vm.serializeUint(o, "borrow", borrowGas);
        string memory json = vm.serializeUint(o, "cliff_liquidate", liquidateGas);
        if (vm.envOr("WRITE_GAS", false)) vm.writeJson(json, "./results/gas.json");
        console2.log(json);
    }
}
