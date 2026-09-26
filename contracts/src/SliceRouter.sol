// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISliceRouter} from "./interfaces/ISliceRouter.sol";
import {MockAMM} from "./mocks/MockAMM.sol";

/// @title SliceRouter
/// @notice Sells collateral slices into the AMM only when the AMM agrees with the oracle.
/// @dev A manipulated pool can't be used to dump someone's collateral cheaply: the sale is skipped
///      (not reverted) so the pool can retry next block.
contract SliceRouter is ISliceRouter {
    using SafeERC20 for IERC20;

    MockAMM public immutable amm;
    IERC20 public immutable tokenIn; // mETH

    uint256 public constant BAND_BPS = 200; // AMM spot must be within 2% of oracle
    uint256 public constant MAX_SLIP_BPS = 150; // accept at most 1.5% below oracle value
    uint256 public constant BACKSTOP_BAND_BPS = 1_000; // wider band when health is below the floor
    uint256 public constant BACKSTOP_SLIP_BPS = 500;

    event SliceSold(address indexed pool, uint256 amountIn, uint256 amountOut, uint256 oraclePrice, bool backstop);
    event SliceSkipped(address indexed pool, uint256 amountIn, uint256 oraclePrice, bytes32 reason);

    constructor(MockAMM amm_) {
        amm = amm_;
        tokenIn = amm_.tokenA();
    }

    /// @inheritdoc ISliceRouter
    function slipBps(bool backstop) public pure returns (uint256) {
        return backstop ? BACKSTOP_SLIP_BPS : MAX_SLIP_BPS;
    }

    /// @inheritdoc ISliceRouter
    function trySell(uint256 amountIn, uint256 oraclePrice, bool backstop) external returns (bool ok, uint256 out) {
        if (amountIn == 0 || oraclePrice == 0) return (false, 0);

        uint256 rA = amm.reserveA();
        uint256 rB = amm.reserveB();
        if (rA == 0 || rB == 0) {
            emit SliceSkipped(msg.sender, amountIn, oraclePrice, "no_liquidity");
            return (false, 0);
        }

        uint256 spot = rB * 1e18 / rA;
        uint256 diff = spot > oraclePrice ? spot - oraclePrice : oraclePrice - spot;
        uint256 band = backstop ? BACKSTOP_BAND_BPS : BAND_BPS;
        if (diff * 10_000 > oraclePrice * band) {
            emit SliceSkipped(msg.sender, amountIn, oraclePrice, "price_band");
            return (false, 0);
        }

        uint256 fair = amountIn * oraclePrice / 1e18;
        uint256 minOut = fair * (10_000 - slipBps(backstop)) / 10_000;
        uint256 quoted = amm.getAmountOut(amountIn, rA, rB);
        if (quoted < minOut || quoted == 0) {
            emit SliceSkipped(msg.sender, amountIn, oraclePrice, "slippage");
            return (false, 0);
        }

        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        tokenIn.forceApprove(address(amm), amountIn);
        out = amm.swapAForB(amountIn, minOut, msg.sender);
        ok = true;
        emit SliceSold(msg.sender, amountIn, out, oraclePrice, backstop);
    }
}
