import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // web/ is the app root (the repo root has an unrelated lockfile)
    root: path.join(__dirname),
    resolveAlias: {
      // RainbowKit bundles wagmi's Base Account connector, whose subscription-payment helpers import
      // @coinbase/cdp-sdk, which in turn imports optional x402 packages that aren't installed. We never
      // use subscriptions, so swap the SDK for a stub that throws if called.
      "@coinbase/cdp-sdk": "./lib/cdp-sdk-stub.ts",
    },
  },
};

export default nextConfig;
