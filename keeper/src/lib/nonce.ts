// One sender key, one nonce sequence. Transactions are sent one after another, never in parallel.

import type { Address, PublicClient } from "viem";

export class NonceManager {
  private nextNonce: number | undefined;
  constructor(
    private readonly client: PublicClient,
    private readonly address: Address,
  ) {}

  async next(): Promise<number> {
    if (this.nextNonce === undefined) {
      this.nextNonce = await this.client.getTransactionCount({ address: this.address, blockTag: "pending" });
    }
    return this.nextNonce++;
  }

  /** After a failed send, re-read the chain's view instead of guessing. */
  resync() {
    this.nextNonce = undefined;
  }
}
