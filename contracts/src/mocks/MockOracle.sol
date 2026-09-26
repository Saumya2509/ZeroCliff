// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOracle} from "../interfaces/IOracle.sol";

/// @title MockOracle
/// @notice Owner-set price for demos, crash replay and the offline finale.
contract MockOracle is IOracle, Ownable {
    uint256 public price;
    uint256 public updatedAt;
    /// @notice Max price age in seconds; 0 disables the staleness check (default, for long demos).
    uint256 public maxAge;

    event PriceSet(uint256 price);
    event MaxAgeSet(uint256 maxAge);

    error ZeroPrice();
    error StalePrice(uint256 updatedAt);

    constructor(uint256 initialPrice) Ownable(msg.sender) {
        if (initialPrice == 0) revert ZeroPrice();
        price = initialPrice;
        updatedAt = block.timestamp;
        emit PriceSet(initialPrice);
    }

    /// @notice Set a new price (WAD, mUSD per mETH).
    function setPrice(uint256 newPrice) external onlyOwner {
        if (newPrice == 0) revert ZeroPrice();
        price = newPrice;
        updatedAt = block.timestamp;
        emit PriceSet(newPrice);
    }

    /// @notice Enable (non-zero) or disable (zero) the staleness check.
    function setMaxAge(uint256 newMaxAge) external onlyOwner {
        maxAge = newMaxAge;
        emit MaxAgeSet(newMaxAge);
    }

    /// @inheritdoc IOracle
    function getPrice() external view returns (uint256, uint256) {
        if (maxAge != 0 && block.timestamp > updatedAt + maxAge) revert StalePrice(updatedAt);
        return (price, updatedAt);
    }
}
