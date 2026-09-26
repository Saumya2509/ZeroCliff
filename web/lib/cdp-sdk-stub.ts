// Stand-in for @coinbase/cdp-sdk (see next.config.ts). Only Base Account's subscription-payment
// helpers use it, and this app never calls them. Fails loudly if that ever changes.
export class CdpClient {
  constructor() {
    throw new Error("@coinbase/cdp-sdk is not bundled in this app");
  }
}
