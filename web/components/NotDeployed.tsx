import { Notice } from "./ui";

/** Shown wherever live contract data would appear, until deployments.json has addresses. */
export function NotDeployed() {
  return (
    <Notice title="Contracts are not deployed yet">
      This build has no contract addresses. After deploying, run <code className="font-mono">npm run abis</code> in{" "}
      <code className="font-mono">web/</code> to copy <code className="font-mono">deployments/active.json</code>, then
      rebuild. Everything that doesn’t need the chain (Simulate, How it works) works now.
    </Notice>
  );
}
