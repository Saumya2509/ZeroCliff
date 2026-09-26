// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MockAMM
/// @notice Constant-product (x·y = k) mETH/mUSD pool with Uniswap v2 maths and a 0.30% fee.
/// @dev Our own pool with known liquidity keeps slippage experiments reproducible.
contract MockAMM is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 30; // 0.30%

    IERC20 public immutable tokenA; // mETH
    IERC20 public immutable tokenB; // mUSD
    uint256 public reserveA;
    uint256 public reserveB;

    event Swap(address indexed from, bool aToB, uint256 amountIn, uint256 amountOut, address indexed to);
    event Sync(uint256 reserveA, uint256 reserveB);
    event LiquidityAdded(uint256 amountA, uint256 amountB);

    error Slippage(uint256 out, uint256 minOut);
    error ZeroAmount();
    error NoLiquidity();

    constructor(IERC20 tokenA_, IERC20 tokenB_) Ownable(msg.sender) {
        tokenA = tokenA_;
        tokenB = tokenB_;
    }

    /// @notice Uniswap v2 output for `amountIn` against reserves `rIn`/`rOut`.
    function getAmountOut(uint256 amountIn, uint256 rIn, uint256 rOut) public pure returns (uint256) {
        uint256 inWithFee = amountIn * (10_000 - FEE_BPS);
        return inWithFee * rOut / (rIn * 10_000 + inWithFee);
    }

    /// @notice mUSD per mETH, WAD.
    function spotPrice() public view returns (uint256) {
        if (reserveA == 0) revert NoLiquidity();
        return reserveB * 1e18 / reserveA;
    }

    /// @notice Add liquidity at any ratio (owner only; demo pool).
    function addLiquidity(uint256 amountA, uint256 amountB) external onlyOwner nonReentrant {
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);
        reserveA += amountA;
        reserveB += amountB;
        emit LiquidityAdded(amountA, amountB);
        emit Sync(reserveA, reserveB);
    }

    /// @notice Sell mETH for mUSD.
    function swapAForB(uint256 amountIn, uint256 minOut, address to) external nonReentrant returns (uint256 out) {
        out = _swap(tokenA, tokenB, true, amountIn, minOut, to);
    }

    /// @notice Sell mUSD for mETH.
    function swapBForA(uint256 amountIn, uint256 minOut, address to) external nonReentrant returns (uint256 out) {
        out = _swap(tokenB, tokenA, false, amountIn, minOut, to);
    }

    function _swap(IERC20 tIn, IERC20 tOut, bool aToB, uint256 amountIn, uint256 minOut, address to)
        internal
        returns (uint256 out)
    {
        if (amountIn == 0) revert ZeroAmount();
        (uint256 rIn, uint256 rOut) = aToB ? (reserveA, reserveB) : (reserveB, reserveA);
        if (rIn == 0 || rOut == 0) revert NoLiquidity();
        out = getAmountOut(amountIn, rIn, rOut);
        if (out < minOut || out == 0) revert Slippage(out, minOut);

        if (aToB) {
            reserveA = rIn + amountIn;
            reserveB = rOut - out;
        } else {
            reserveB = rIn + amountIn;
            reserveA = rOut - out;
        }
        tIn.safeTransferFrom(msg.sender, address(this), amountIn);
        tOut.safeTransfer(to, out);
        emit Swap(msg.sender, aToB, amountIn, out, to);
        emit Sync(reserveA, reserveB);
    }
}
