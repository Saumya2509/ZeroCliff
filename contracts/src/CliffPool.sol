// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {LendingPoolBase} from "./LendingPoolBase.sol";

/// @title CliffPool
/// @notice Baseline with classic threshold liquidation (50% close factor, 8% bonus). Hosts the
///         "ghost" positions the app shows next to each Soft Landing position.
contract CliffPool is LendingPoolBase {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 public constant CLOSE_FACTOR = 0.5e18;
    uint256 public constant BONUS = 1.08e18;

    event Liquidated(
        address indexed user, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized, uint256 health
    );
    event BadDebtRecorded(address indexed user, uint256 amount);

    error Healthy(uint256 health);

    constructor(IERC20 collateral_, IERC20 debtAsset_, IOracle oracle_)
        LendingPoolBase(collateral_, debtAsset_, oracle_)
    {}

    /// @notice Repay up to 50% of an unhealthy user's debt and seize collateral worth repay × 1.08.
    function liquidate(address user, uint256 repayAmount) external nonReentrant returns (uint256 seized) {
        uint256 price = _price();
        Position storage p = positions[user];
        uint256 h = _health(p.collateral, p.debt, price);
        if (h >= WAD) revert Healthy(h);

        uint256 r = Math.min(repayAmount, uint256(p.debt) * CLOSE_FACTOR / WAD);
        if (r == 0) revert NothingToDo();
        seized = Math.min(r * BONUS / price, p.collateral);

        debtAsset.safeTransferFrom(msg.sender, address(this), r);
        p.debt -= r.toUint128();
        totalDebt -= r;
        p.collateral -= seized.toUint128();
        totalCollateral -= seized;

        if (p.collateral == 0 && p.debt > 0) {
            uint256 bad = p.debt;
            p.debt = 0;
            totalDebt -= bad;
            badDebt += bad;
            emit BadDebtRecorded(user, bad);
        }

        collateral.safeTransfer(msg.sender, seized);
        emit Liquidated(user, msg.sender, r, seized, h);
    }

    /// @dev Cliff pool has nothing to settle before user actions.
    function _settle(address, bool) internal override {}
}
