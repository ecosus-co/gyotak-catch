/*
 * check-mainnet-balance.ts (READ-ONLY, Mainnet)
 *
 * Purpose:
 *   Sync the Mainnet wallet derived from .env.mainnet.bak and print
 *   NIGHT / DUST balances. Used as pre-flight before deploy:mainnet.
 *
 * Behavior:
 *   - Read-only. Does NOT touch D1, does NOT submit any TX.
 *   - Does NOT modify .env (current Preview cron seed). Reads
 *     .env.mainnet.bak directly via fs.
 *   - Uses MainnetConfig from src/config.ts (mainnet indexer/node URLs,
 *     networkId='mainnet').
 *   - Calls waitForSync() only — NOT waitForFunds() — so it returns
 *     even when balance is 0.
 *
 * Usage:
 *   cd ~/midnight/gyotak-catch
 *   node --no-warnings --loader ts-node/esm scripts/check-mainnet-balance.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';

import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';

import { MainnetConfig } from '../src/config.js';
import { waitForSync } from '../src/api.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).WebSocket = WebSocket;

const ENV_FILE = '.env.mainnet.bak';
const NETWORK_ID = 'mainnet' as const;

const readSeed = (): string => {
  const raw = readFileSync(resolve(process.cwd(), ENV_FILE), 'utf8');
  for (const line of raw.split('\n')) {
    if (line.startsWith('WALLET_SEED=')) {
      return line.slice('WALLET_SEED='.length).trim();
    }
  }
  throw new Error(`WALLET_SEED not found in ${ENV_FILE}`);
};

const main = async (): Promise<number> => {
  console.log('========================================');
  console.log('check-mainnet-balance  (READ-ONLY, no writes, no TX)');
  console.log('========================================\n');

  const config = new MainnetConfig();
  const seed = readSeed();

  console.log(`Network:    ${NETWORK_ID}`);
  console.log(`Seed src:   ${ENV_FILE}`);
  console.log(`Indexer:    ${config.indexer}`);
  console.log(`Node:       ${config.node}`);
  console.log(`ProofSrv:   ${config.proofServer}`);
  console.log('');

  const t0 = Date.now();

  const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('HDWallet.fromSeed failed');
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error('deriveKeysAt failed');

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(derived.keys[Roles.NightExternal], NETWORK_ID);
  hd.hdWallet.clear();

  const unshieldedAddr = unshieldedKeystore.getBech32Address().toString();
  const coinPk = ShieldedCoinPublicKey.fromHexString(shieldedSecretKeys.coinPublicKey);
  const encPk = ShieldedEncryptionPublicKey.fromHexString(shieldedSecretKeys.encryptionPublicKey);
  const shieldedAddr = MidnightBech32m.encode(NETWORK_ID, new ShieldedAddress(coinPk, encPk)).toString();

  console.log(`Unshielded address: ${unshieldedAddr}`);
  console.log(`Shielded address:   ${shieldedAddr}`);
  console.log('');

  const indexerClientConnection = {
    indexerHttpUrl: config.indexer,
    indexerWsUrl: config.indexerWS,
  };
  const walletConfig = {
    networkId: NETWORK_ID,
    indexerClientConnection,
    provingServerUrl: new URL(config.proofServer),
    relayURL: new URL(config.node.replace(/^http/, 'ws')),
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (cfg: any) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg: any) =>
      UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg: any) =>
      DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  process.stdout.write('Syncing');
  const tick = setInterval(() => process.stdout.write('.'), 2000);

  let exitCode = 0;
  try {
    const state = await waitForSync(wallet);
    clearInterval(tick);
    process.stdout.write(' done\n');

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const nightRaw = unshieldedToken().raw;
    const nightBalance = state.unshielded.balances[nightRaw] ?? 0n;
    const dustBalance = state.dust.balance(new Date());
    const nightCoins = state.unshielded.availableCoins.length;
    const registeredNight = state.unshielded.availableCoins.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c.meta?.registeredForDustGeneration === true,
    ).length;
    const dustCoins = state.dust.availableCoins.length;

    console.log('');
    console.log(`Sync time:    ${elapsed}s`);
    console.log(`NIGHT bal:    ${nightBalance.toLocaleString()}  (${nightCoins} coins, ${registeredNight} registered for dust)`);
    console.log(`DUST bal:     ${dustBalance.toLocaleString()}  (${dustCoins} coins)`);
    console.log('');
    if (nightBalance > 0n && dustBalance > 0n) {
      console.log('Verdict: (a) NIGHT and DUST both present — deploy:mainnet ready.');
    } else if (nightBalance === 0n && dustBalance > 0n) {
      console.log('Verdict: (b) NIGHT empty, DUST present — investigate NIGHT loss / bridge.');
    } else if (nightBalance > 0n && dustBalance === 0n) {
      console.log('Verdict: (c) NIGHT present, DUST empty — DUST generation may be stalled.');
    } else {
      console.log('Verdict: (d) Both empty — bridge incomplete or wallet drained.');
    }
  } catch (e) {
    clearInterval(tick);
    console.log('');
    console.error(`Sync failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    exitCode = 1;
  } finally {
    await wallet.stop();
    shieldedSecretKeys.clear();
    dustSecretKey.clear();
  }

  return exitCode;
};

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    process.exit(1);
  });
