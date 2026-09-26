// Entry point: MODE=offline RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 KEEPER_PRIVATE_KEY=0x… npx tsx src/index.ts
import { loadConfig } from "./config";
import { startKeeper } from "./keeper";

const keeper = await startKeeper(loadConfig());

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    keeper.ctx.log.info({ signal: sig, ...keeper.status() }, "stopping");
    await keeper.stop();
    process.exit(0);
  });
}
