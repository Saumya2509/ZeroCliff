// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Sells collateral slices into the AMM behind an oracle price guard.
interface ISliceRouter {
    /// @notice Sell `amountIn` collateral pulled from the caller; proceeds go to the caller.
    /// @param oraclePrice Price the caller measured health with (WAD)
    /// @param backstop Use the wider backstop band and slippage limit
    /// @return ok False (and nothing moved) if the AMM is outside the band or the quote is too low
    /// @return out Debt asset received
    function trySell(uint256 amountIn, uint256 oraclePrice, bool backstop) external returns (bool ok, uint256 out);

    /// @notice Worst execution accepted, in bps below oracle value.
    function slipBps(bool backstop) external view returns (uint256);
}
