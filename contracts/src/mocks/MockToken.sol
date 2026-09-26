// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockToken
/// @notice 18-decimal test token with a rate-limited public faucet, so judges can get mETH and mUSD.
contract MockToken is ERC20, Ownable {
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice Amount minted per faucet claim.
    uint256 public immutable faucetAmount;
    /// @notice Timestamp of each address's last faucet claim.
    mapping(address => uint256) public lastClaim;

    event FaucetClaimed(address indexed to, uint256 amount);

    error FaucetCooldown(uint256 availableAt);

    constructor(string memory name_, string memory symbol_, uint256 faucetAmount_)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        faucetAmount = faucetAmount_;
    }

    /// @notice Mint `faucetAmount` to the caller, at most once per hour.
    function faucet() external {
        uint256 last = lastClaim[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) revert FaucetCooldown(last + FAUCET_COOLDOWN);
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
        emit FaucetClaimed(msg.sender, faucetAmount);
    }

    /// @notice Owner mint for seeding pools and liquidity.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
