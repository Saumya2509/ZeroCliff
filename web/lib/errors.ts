import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { formatHealth } from "./format";

// Contract and wallet errors → one plain sentence that says what to do next.

type Decoded = { name: string; args: readonly unknown[] };

function decode(e: unknown): Decoded | "rejected" | undefined {
  if (!(e instanceof BaseError)) return undefined;
  if (e.walk((x) => x instanceof UserRejectedRequestError)) return "rejected";
  const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) {
    return { name: reverted.data.errorName, args: reverted.data.args ?? [] };
  }
  if (/user (rejected|denied)/i.test(e.message)) return "rejected";
  return undefined;
}

export function toPlainMessage(e: unknown): string {
  const d = decode(e);
  if (d === "rejected") return "Transaction cancelled in wallet.";
  if (d) {
    switch (d.name) {
      case "HealthTooLow":
        return `That would put your health at ${formatHealth(d.args[0] as bigint)}. Borrow less or add collateral to stay above 1.40.`;
      case "ZeroAmount":
        return "Enter an amount above zero.";
      case "NothingToDo":
        return "There is nothing to repay.";
      case "StalePrice":
      case "InvalidPrice":
      case "BadPrice":
      case "WideConfidence":
        return "The price feed is updating. Try again in a few seconds.";
      case "FaucetCooldown":
        return "You already claimed test tokens this hour. Try again later.";
      case "Healthy":
        return "That position is healthy, so it can't be liquidated.";
      case "OwnableUnauthorizedAccount":
        return "Only the demo admin can do that.";
      case "ERC20InsufficientBalance":
        return "Not enough tokens in your wallet. Use “Get test tokens” first.";
      case "ERC20InsufficientAllowance":
        return "Token approval is missing. Try again to approve first.";
      case "SafeCastOverflowedUintDowncast":
        return "That amount is too large.";
    }
    return `The contract rejected this (${d.name}).`;
  }
  const rawMsg = e instanceof Error ? e.message : String(e);
  if (/nonce too low/i.test(rawMsg) || /nonce has already been used/i.test(rawMsg)) {
    return "Wallet nonce was out of sync. Click 'Try again' to submit with the updated nonce.";
  }
  if (e instanceof BaseError) return e.shortMessage;
  return "Something went wrong. Please try again.";
}
