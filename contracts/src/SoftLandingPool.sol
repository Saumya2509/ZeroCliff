// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IOracle} from "./interfaces/IOracle.sol";
import {ISliceRouter} from "./interfaces/ISliceRouter.sol";
import {LendingPoolBase} from "./LendingPoolBase.sol";

/// @title SoftLandingPool
/// @notice Lending pool with no liquidation event. Below a comfort level it sells a small slice of
///         collateral every block and repays debt with it; the slice grows as health falls and stops
///         by itself when the price recovers. Only possible because onchain settlement is instant,
///         atomic and runs 24/7.
contract SoftLandingPool is LendingPoolBase {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    uint256 public constant H_COMFORT = 1.25e18;
    uint256 public constant H_FLOOR = 1.02e18;
    uint256 public constant R_MAX = 0.005e18; // max share of collateral sold per block
    uint256 public constant N_MAX = 100; // max blocks accrued in one poke
    uint256 public constant FEE = 0.001e18; // protocol fee on each slice
    uint256 public constant MAX_BATCH = 20;
    uint256 public constant MAX_PREVIEW_BLOCKS = 200;

    ISliceRouter public router;
    /// @notice Flat reward to the poke caller. Never a percentage, so there's nothing to race for.
    uint256 public tip = 0.5e18;
    /// @notice Fees collected in mUSD; tips are paid out of this.
    uint256 public protocolFees;

    event Glided(
        address indexed user,
        uint256 collateralSold,
        uint256 debtRepaid,
        uint256 healthBefore,
        uint256 healthAfter,
        uint256 blocksAccrued
    );
    event GlideSkipped(address indexed user, bytes32 reason);
    event BackstopLiquidated(address indexed user, uint256 collateralSold, uint256 debtRepaid, uint256 shortfall);
    event Refunded(address indexed user, uint256 amount);
    event TipPaid(address indexed caller, uint256 amount);
    event TipUpdated(uint256 tip);
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);

    error TooManyUsers();
    error PreviewRange();

    constructor(IERC20 collateral_, IERC20 debtAsset_, IOracle oracle_, ISliceRouter router_)
        LendingPoolBase(collateral_, debtAsset_, oracle_)
    {
        router = router_;
        // guarantees the s_needed denominator is positive
        require(H_COMFORT * (WAD - FEE) / WAD > LT, "bad params");
    }

    // ---------- keeper actions ----------

    /// @notice Settle `user`'s glide. Anyone can call; pays the flat tip only if something happened.
    function poke(address user) external nonReentrant returns (bool acted) {
        acted = _glide(user, true);
        if (acted) _payTip(msg.sender);
    }

    /// @notice Bounded batch so the keeper can save gas. One tip for the batch if any user acted.
    function pokeMany(address[] calldata users) external nonReentrant returns (uint256 actedCount) {
        if (users.length > MAX_BATCH) revert TooManyUsers();
        for (uint256 i; i < users.length; ++i) {
            if (_glide(users[i], true)) ++actedCount;
        }
        if (actedCount > 0) _payTip(msg.sender);
    }

    // ---------- admin ----------

    function setTip(uint256 newTip) external onlyOwner {
        tip = newTip;
        emit TipUpdated(newTip);
    }

    function setRouter(ISliceRouter newRouter) external onlyOwner {
        emit RouterUpdated(address(router), address(newRouter));
        router = newRouter;
    }

    // ---------- views ----------

    /// @notice Share of collateral sold per block at health `h` (WAD). Linear from 0 at comfort to R_MAX at floor.
    function glideRate(uint256 h) public pure returns (uint256) {
        if (h >= H_COMFORT) return 0;
        if (h <= H_FLOOR) return R_MAX;
        return R_MAX * (H_COMFORT - h) / (H_COMFORT - H_FLOOR);
    }

    /// @notice Collateral that must be sold to bring health exactly back to comfort.
    function sNeeded(uint256 c, uint256 d, uint256 price) public pure returns (uint256) {
        uint256 lhs = H_COMFORT * d / WAD;
        uint256 rhs = c * price / WAD * LT / WAD;
        if (lhs <= rhs) return 0;
        uint256 denom = price * (H_COMFORT * (WAD - FEE) / WAD - LT) / WAD;
        return (lhs - rhs) * WAD / denom;
    }

    /// @notice Collateral a poke sells after `n` blocks (n capped at N_MAX) between floor and comfort.
    /// @dev share = 1 − (1 − r)^n. The rate uses health at the start of the poke, which slightly over-sells
    ///      within one poke; capping at sNeeded removes that (known, documented approximation).
    function glideSlice(uint256 c, uint256 d, uint256 price, uint256 n) public pure returns (uint256) {
        uint256 h = _health(c, d, price);
        if (h >= H_COMFORT || h < H_FLOOR) return 0;
        if (n > N_MAX) n = N_MAX;
        uint256 r = glideRate(h);
        uint256 remaining = WAD;
        for (uint256 i; i < n; ++i) {
            remaining = remaining * (WAD - r) / WAD;
        }
        return Math.min(c * (WAD - remaining) / WAD, sNeeded(c, d, price));
    }

    /// @notice Collateral the backstop sells: enough to restore comfort if every unit executes at the
    ///         worst price the backstop accepts (`slipBps` below oracle, minus the fee). Rounds up.
    ///         A result ≥ c means the position can't be restored and will be closed out.
    function backstopSlice(uint256 c, uint256 d, uint256 price, uint256 slipBps_) public pure returns (uint256) {
        uint256 lhs = H_COMFORT * d / WAD;
        uint256 rhs = c * price / WAD * LT / WAD;
        if (lhs <= rhs) return 0;
        uint256 execPrice = price * (10_000 - slipBps_) / 10_000 * (WAD - FEE) / WAD;
        uint256 gain = H_COMFORT * execPrice / WAD;
        uint256 loss = price * LT / WAD;
        if (gain <= loss) return type(uint256).max; // selling can't restore health: close out
        return Math.mulDiv(lhs - rhs, WAD, gain - loss, Math.Rounding.Ceil);
    }

    /// @notice Landing Forecast: health and collateral path, one entry per block, if the price moved by
    ///         `shockBps` now and a poke landed every block. Ignores AMM slippage (documented).
    function previewGlide(address user, int256 shockBps, uint256 blocks)
        external
        view
        returns (uint256[] memory healthPath, uint256[] memory collateralPath)
    {
        if (blocks > MAX_PREVIEW_BLOCKS || shockBps <= -10_000 || shockBps >= 10_000) revert PreviewRange();
        // forge-lint: disable-next-line(unsafe-typecast) -- shockBps checked to be in (-10000, 10000) above
        uint256 price = _price() * uint256(10_000 + shockBps) / 10_000;
        Position memory p = positions[user];
        return previewPath(p.collateral, p.debt, price, blocks);
    }

    /// @notice Pure version of the forecast for arbitrary inputs (used by the app before a position exists).
    function previewPath(uint256 c, uint256 d, uint256 price, uint256 blocks)
        public
        pure
        returns (uint256[] memory healthPath, uint256[] memory collateralPath)
    {
        if (blocks > MAX_PREVIEW_BLOCKS) revert PreviewRange();
        healthPath = new uint256[](blocks);
        collateralPath = new uint256[](blocks);
        for (uint256 i; i < blocks; ++i) {
            uint256 h = _health(c, d, price);
            if (h < H_COMFORT && h >= H_FLOOR) {
                uint256 s = Math.min(c * glideRate(h) / WAD, sNeeded(c, d, price));
                uint256 repayAmt = s * price / WAD * (WAD - FEE) / WAD;
                c -= s;
                d = repayAmt >= d ? 0 : d - repayAmt;
                h = _health(c, d, price);
            }
            healthPath[i] = h;
            collateralPath[i] = c;
        }
    }

    // ---------- internal ----------

    function _settle(address user, bool strict) internal override {
        _glide(user, strict);
    }

    /// @dev Returns true if collateral was sold. `strict` = revert on oracle failure; otherwise skip quietly.
    function _glide(address user, bool strict) internal returns (bool) {
        Position storage p = positions[user];
        if (p.debt == 0) {
            p.lastGlideBlock = uint64(block.number);
            return false;
        }
        uint256 n = block.number - p.lastGlideBlock;
        if (n == 0) return false;

        uint256 price;
        if (strict) {
            price = _price();
        } else {
            try oracle.getPrice() returns (uint256 px, uint256) {
                if (px == 0) return false;
                price = px;
            } catch {
                return false; // safe actions (deposit, repay) must always work
            }
        }

        uint256 h = _health(p.collateral, p.debt, price);
        if (h >= H_COMFORT) {
            p.lastGlideBlock = uint64(block.number);
            return false;
        }
        if (h < H_FLOOR) return _backstop(user, p, price);

        if (n > N_MAX) n = N_MAX;
        uint256 s = glideSlice(p.collateral, p.debt, price, n);
        if (s == 0) {
            p.lastGlideBlock = uint64(block.number);
            return false;
        }

        (bool ok, uint256 out) = _sell(s, price, false);
        if (!ok) {
            emit GlideSkipped(user, "price_band"); // lastGlideBlock unchanged, so it retries next block
            return false;
        }

        uint256 repayAmt = _applySale(user, p, s, out);
        uint256 hAfter = _health(p.collateral, p.debt, price);
        emit Glided(user, s, repayAmt, h, hAfter, n);
        return true;
    }

    /// @dev Health fell below the floor (e.g. a price gap). Sell only what restores comfort at worst-case
    ///      backstop execution; no bonus. Closing the whole position here would re-create the cliff (and
    ///      back-to-back backstops would cascade in the AMM). If restoring comfort needs all the collateral,
    ///      sell it all and record whatever debt is left as bad debt.
    function _backstop(address user, Position storage p, uint256 price) internal returns (bool) {
        uint256 c = p.collateral;
        uint256 s = backstopSlice(c, p.debt, price, router.slipBps(true));
        bool closeOut = s >= c;
        if (closeOut) s = c;

        uint256 repayAmt;
        if (s > 0) {
            (bool ok, uint256 out) = _sell(s, price, true);
            if (!ok) {
                emit GlideSkipped(user, "backstop_band");
                return false;
            }
            repayAmt = _applySale(user, p, s, out);
        }

        uint256 shortfall;
        if (closeOut && p.debt > 0) {
            shortfall = p.debt;
            p.debt = 0;
            totalDebt -= shortfall;
            badDebt += shortfall;
        }
        p.lastGlideBlock = uint64(block.number);
        emit BackstopLiquidated(user, s, repayAmt, shortfall);
        return true;
    }

    function _sell(uint256 s, uint256 price, bool backstop) internal returns (bool ok, uint256 out) {
        collateral.forceApprove(address(router), s);
        (ok, out) = router.trySell(s, price, backstop);
        collateral.forceApprove(address(router), 0);
    }

    /// @dev Book a completed sale: fee, repay, refund any excess to the user. Returns debt repaid.
    function _applySale(address user, Position storage p, uint256 s, uint256 out) internal returns (uint256 repayAmt) {
        uint256 feeAmt = out * FEE / WAD;
        uint256 net = out - feeAmt;
        repayAmt = Math.min(net, p.debt);
        uint256 refund = net - repayAmt;
        protocolFees += feeAmt;

        p.collateral -= s.toUint128();
        totalCollateral -= s;
        p.debt -= repayAmt.toUint128();
        totalDebt -= repayAmt;
        p.lastGlideBlock = uint64(block.number);

        if (refund > 0) {
            debtAsset.safeTransfer(user, refund);
            emit Refunded(user, refund);
        }
    }

    function _payTip(address to) internal {
        uint256 t = tip;
        if (t == 0 || protocolFees < t) return;
        protocolFees -= t;
        debtAsset.safeTransfer(to, t);
        emit TipPaid(to, t);
    }
}
