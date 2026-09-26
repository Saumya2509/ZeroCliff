// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IOracle} from "../../src/interfaces/IOracle.sol";
import {ISliceRouter} from "../../src/interfaces/ISliceRouter.sol";
import {SoftLandingPool} from "../../src/SoftLandingPool.sol";

/// @notice Writes 50 fixed glide scenarios (all integers as decimal strings, so JS parses them losslessly) to vectors/glide_<i>.json. The TypeScript simulator (05) must
///         reproduce every output exactly (integer maths, same rounding) to claim parity with the contract.
contract ExportVectorsTest is Test {
    uint256 internal constant N = 50;
    uint256 internal constant PREVIEW_BLOCKS = 20;

    function test_exportVectors() public {
        // pure functions only; token/oracle/router addresses are never touched
        SoftLandingPool pool =
            new SoftLandingPool(IERC20(address(1)), IERC20(address(2)), IOracle(address(3)), ISliceRouter(address(4)));

        for (uint256 i; i < N; ++i) {
            _write(pool, i);
        }
    }

    function _write(SoftLandingPool pool, uint256 i) internal {
        uint256 c = 1e18 + uint256(keccak256(abi.encode("c", i))) % 99e18; // 1–100 mETH
        uint256 price = 500e18 + uint256(keccak256(abi.encode("p", i))) % 9_500e18; // 500–10,000
        // start health spread over 0.95–1.35 so every branch (backstop, glide, idle) appears
        uint256 d = c * price / 1e18 * 0.85e18 / (0.95e18 + (0.4e18 * i) / (N - 1));
        uint256 blocks = 1 + uint256(keccak256(abi.encode("n", i))) % 150;
        uint256 health = c * price / 1e18 * 0.85e18 / d;

        string memory o = string.concat("v", vm.toString(i));
        vm.serializeString(o, "index", vm.toString(i));
        vm.serializeString(o, "collateralBefore", vm.toString(c));
        vm.serializeString(o, "debtBefore", vm.toString(d));
        vm.serializeString(o, "price", vm.toString(price));
        vm.serializeString(o, "blocks", vm.toString(blocks));
        vm.serializeString(o, "health", vm.toString(health));
        vm.serializeString(o, "glideRate", vm.toString(pool.glideRate(health)));
        vm.serializeString(o, "sNeeded", vm.toString(pool.sNeeded(c, d, price)));
        vm.serializeString(o, "glideSlice", vm.toString(pool.glideSlice(c, d, price, blocks)));
        vm.serializeString(o, "backstopSlice", vm.toString(pool.backstopSlice(c, d, price, 500)));
        vm.serializeString(o, "previewBlocks", vm.toString(PREVIEW_BLOCKS));
        (uint256[] memory hPath, uint256[] memory cPath) = pool.previewPath(c, d, price, PREVIEW_BLOCKS);
        vm.serializeString(o, "previewHealth", _str(hPath));
        string memory out = vm.serializeString(o, "previewCollateral", _str(cPath));
        vm.writeJson(out, string.concat("./vectors/glide_", vm.toString(i), ".json"));
    }

    function _str(uint256[] memory xs) internal pure returns (string[] memory out) {
        out = new string[](xs.length);
        for (uint256 i; i < xs.length; ++i) {
            out[i] = vm.toString(xs[i]);
        }
    }
}
