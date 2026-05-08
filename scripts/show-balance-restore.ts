// Wallet balance via restore path (replaces show-balance.mjs for persisted-state networks).
// Mirrors the wallet-build path used by deploy:preprod / record-catch:preprod
// so that restore-from-saved is exercised and balances surface via api.ts's
// printWalletSummary side effect. Single-shot: build → save → stop → exit.
//
// Unlike scripts/show-balance.mjs, this honours config.walletStateDir, so on
// Preprod (and any future Mainnet) it restores in seconds instead of cold
// syncing from genesis (~170 min on Preprod).
import { PreprodConfig } from '../src/config.js';
import { createLogger } from '../src/logger-utils.js';
import * as api from '../src/api.js';
import { readSeed } from '../src/cli.js';

const config = new PreprodConfig();
const logger = await createLogger(config.logDir);
api.setLogger(logger);

try {
  const ctx = await api.buildWalletAndWaitForFunds(config, readSeed());
  await api.saveWalletStates(ctx.wallet, config.walletStateDir);
  await ctx.wallet.stop();
  process.exit(0);
} catch (e) {
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : JSON.stringify(e);
  logger.error({ err: msg }, 'D-3-alt failed');
  process.stderr.write(`D-3-alt failed: ${msg}\n`);
  process.exit(2);
}
