import { ContractFunctionRevertedError, encodeErrorResult, UserRejectedRequestError } from "viem";
import { describe, expect, it } from "vitest";
import { softLandingPoolAbi } from "./abis";
import { toPlainMessage } from "./errors";

function revert(errorName: string, args: readonly unknown[] = []) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = encodeErrorResult({ abi: softLandingPoolAbi, errorName, args } as any);
  return new ContractFunctionRevertedError({ abi: softLandingPoolAbi, data, functionName: "borrow" });
}

describe("toPlainMessage", () => {
  it("explains HealthTooLow with the resulting health", () => {
    expect(toPlainMessage(revert("HealthTooLow", [1_310_000_000_000_000_000n]))).toBe(
      "That would put your health at 1.31. Borrow less or add collateral to stay above 1.40.",
    );
  });

  it("maps ZeroAmount", () => {
    expect(toPlainMessage(revert("ZeroAmount"))).toBe("Enter an amount above zero.");
  });

  it("maps a wallet rejection", () => {
    expect(toPlainMessage(new UserRejectedRequestError(new Error("User rejected the request.")))).toBe(
      "Transaction cancelled in wallet.",
    );
  });

  it("falls back to a generic sentence for unknown errors", () => {
    expect(toPlainMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});
