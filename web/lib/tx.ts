import { readContract, simulateContract, writeContract } from "wagmi/actions";
import { type Abi, type Address, type ContractFunctionArgs, type ContractFunctionName } from "viem";
import { mockTokenAbi } from "./abis";
import { config } from "./wagmi";

// Always simulate first: it catches reverts before the wallet pops up, so judges never see a
// failed transaction. Then send exactly the simulated request.

export async function send<
  const abi extends Abi,
  name extends ContractFunctionName<abi, "nonpayable" | "payable">,
>(params: {
  address: Address;
  abi: abi;
  functionName: name;
  args: ContractFunctionArgs<abi, "nonpayable" | "payable", name>;
  account: Address;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { request } = await simulateContract(config, params as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return writeContract(config, request as any);
}

/** Approve `spender` if the current allowance is below `amount`; returns undefined when not needed. */
export async function approveIfNeeded(token: Address, spender: Address, amount: bigint, account: Address) {
  const allowance = await readContract(config, {
    address: token,
    abi: mockTokenAbi,
    functionName: "allowance",
    args: [account, spender],
  });
  if (allowance >= amount) return undefined;
  return send({ address: token, abi: mockTokenAbi, functionName: "approve", args: [spender, amount], account });
}
