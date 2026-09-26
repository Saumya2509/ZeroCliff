// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IOracle} from "./interfaces/IOracle.sol";

/// @title LendingPoolBase
/// @notice Shared deposit/borrow/repay/withdraw accounting for SoftLandingPool and CliffPool, so the
///         two differ only in how risky loans are unwound. Same LT and H_OPEN keep comparisons fair.
abstract contract LendingPoolBase is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 internal constant WAD = 1e18;

    /// @notice Liquidation threshold.
    uint256 public constant LT = 0.85e18;
    /// @notice Minimum health to borrow or withdraw.
    uint256 public constant H_OPEN = 1.4e18;

    IERC20 public immutable collateral; // mETH
    IERC20 public immutable debtAsset; // mUSD
    IOracle public oracle;

    struct Position {
        uint128 collateral;
        uint128 debt;
        uint64 lastGlideBlock; // only used by SoftLandingPool
    }

    mapping(address => Position) public positions;
    uint256 public totalCollateral;
    uint256 public totalDebt;
    /// @notice mUSD supplied as lending liquidity (no lender withdrawals in the MVP).
    uint256 public totalFunded;
    /// @notice Debt written off because collateral could not cover it. Never hidden.
    uint256 public badDebt;

    event Funded(address indexed from, uint256 amount);
    event Deposited(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    error HealthTooLow(uint256 health);
    error ZeroAmount();
    error NothingToDo();
    error InvalidPrice();

    constructor(IERC20 collateral_, IERC20 debtAsset_, IOracle oracle_) Ownable(msg.sender) {
        collateral = collateral_;
        debtAsset = debtAsset_;
        oracle = oracle_;
    }

    // ---------- user actions ----------

    /// @notice Supply mUSD lending liquidity to the pool.
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        debtAsset.safeTransferFrom(msg.sender, address(this), amount);
        totalFunded += amount;
        emit Funded(msg.sender, amount);
    }

    /// @notice Add mETH collateral. Works even if the oracle is down (it makes positions safer).
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _settle(msg.sender, false);
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        Position storage p = positions[msg.sender];
        p.collateral += amount.toUint128();
        if (p.lastGlideBlock == 0) p.lastGlideBlock = uint64(block.number);
        totalCollateral += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Borrow mUSD; health after must be at least H_OPEN.
    function borrow(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _settle(msg.sender, true);
        Position storage p = positions[msg.sender];
        p.debt += amount.toUint128();
        totalDebt += amount;
        uint256 h = _health(p.collateral, p.debt, _price());
        if (h < H_OPEN) revert HealthTooLow(h);
        debtAsset.safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }

    /// @notice Repay up to `amount` of debt. Works even if the oracle is down.
    function repay(uint256 amount) external nonReentrant {
        _settle(msg.sender, false);
        Position storage p = positions[msg.sender];
        uint256 pay = Math.min(amount, p.debt);
        if (pay == 0) revert NothingToDo();
        debtAsset.safeTransferFrom(msg.sender, address(this), pay);
        p.debt -= pay.toUint128();
        totalDebt -= pay;
        emit Repaid(msg.sender, pay);
    }

    /// @notice Withdraw mETH; if the position has debt, health after must be at least H_OPEN.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _settle(msg.sender, true);
        Position storage p = positions[msg.sender];
        p.collateral -= amount.toUint128(); // reverts on underflow
        totalCollateral -= amount;
        if (p.debt > 0) {
            uint256 h = _health(p.collateral, p.debt, _price());
            if (h < H_OPEN) revert HealthTooLow(h);
        }
        collateral.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ---------- admin ----------

    /// @notice Switch price source (mock ↔ Pyth). Emits an event; roadmap: timelock.
    function setOracle(IOracle newOracle) external onlyOwner {
        emit OracleUpdated(address(oracle), address(newOracle));
        oracle = newOracle;
    }

    // ---------- views ----------

    /// @notice Health = C·P·LT / D (WAD). Max uint if there is no debt.
    function healthOf(address user) public view returns (uint256) {
        Position memory p = positions[user];
        if (p.debt == 0) return type(uint256).max;
        return _health(p.collateral, p.debt, _price());
    }

    // ---------- internal ----------

    /// @dev Settle any pending unwind before a user action. `strict` actions revert if the oracle fails.
    function _settle(address user, bool strict) internal virtual;

    function _price() internal view returns (uint256 price) {
        (price,) = oracle.getPrice();
        if (price == 0) revert InvalidPrice();
    }

    function _health(uint256 c, uint256 d, uint256 price) internal pure returns (uint256) {
        if (d == 0) return type(uint256).max;
        return c * price / WAD * LT / d;
    }
}
