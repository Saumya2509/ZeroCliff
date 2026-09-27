// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IOracle} from "./interfaces/IOracle.sol";

/// @title PythOracleAdapter
/// @notice Wraps a Pyth pull-oracle feed behind IOracle with age, confidence and exponent checks.
contract PythOracleAdapter is IOracle {
    IPyth public immutable pyth;
    bytes32 public immutable feedId;
    /// @notice Oldest price accepted, in seconds. On mainnet this is typically 60s; on testnet we allow
    ///         older prices (up to MAX_MAX_AGE, e.g. 7-30 days) because testnet feeds update infrequently.
    uint256 public immutable maxAge;
    uint256 public constant MAX_MAX_AGE = 30 days; // allow older prices on testnet (up to 30 days)
    uint256 public constant MAX_CONF_BPS = 100; // reject if confidence > 1% of price

    error BadPrice();
    error WideConfidence();
    error BadExponent(int32 expo);
    error BadMaxAge(uint256 maxAge);

    constructor(IPyth pyth_, bytes32 feedId_, uint256 maxAge_) {
        if (maxAge_ == 0 || maxAge_ > MAX_MAX_AGE) revert BadMaxAge(maxAge_);
        pyth = pyth_;
        feedId = feedId_;
        maxAge = maxAge_;
    }

    /// @inheritdoc IOracle
    function getPrice() external view returns (uint256 priceWad, uint256 updatedAt) {
        PythStructs.Price memory p = pyth.getPriceNoOlderThan(feedId, maxAge); // reverts if stale
        return toWad(p);
    }

    /// @notice Convert a Pyth price to WAD after sanity checks. Public for testing.
    function toWad(PythStructs.Price memory p) public pure returns (uint256 priceWad, uint256 updatedAt) {
        if (p.price <= 0) revert BadPrice();
        uint256 px = uint256(uint64(p.price));
        if (uint256(p.conf) * 10_000 > px * MAX_CONF_BPS) revert WideConfidence();
        // Pyth value = price × 10^expo; expo is usually negative (e.g. -8)
        int256 shift = int256(18) + int256(p.expo);
        if (shift < 0 || shift > 36) revert BadExponent(p.expo);
        // forge-lint: disable-next-line(unsafe-typecast) -- shift checked to be in [0, 36] above
        priceWad = px * 10 ** uint256(shift);
        updatedAt = p.publishTime;
    }

    /// @notice Push a signed Hermes update, pay the Pyth fee and refund the rest.
    function update(bytes[] calldata updateData) external payable {
        uint256 fee = pyth.getUpdateFee(updateData);
        pyth.updatePriceFeeds{value: fee}(updateData);
        if (msg.value > fee) Address.sendValue(payable(msg.sender), msg.value - fee);
    }
}
