// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Price source seen by both pools. Swapping mock for live is one constructor argument.
interface IOracle {
    /// @return priceWad mUSD per 1 mETH, 18 decimals
    /// @return updatedAt unix timestamp of the price
    /// @dev Implementations MUST revert on a stale or invalid price.
    function getPrice() external view returns (uint256 priceWad, uint256 updatedAt);
}
