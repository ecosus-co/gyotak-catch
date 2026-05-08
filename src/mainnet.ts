/*
 * mainnet.ts (Option F: bypass api.buildWalletAndWaitForFunds)
 *
 * Background: api.buildWalletAndWaitForFunds hangs on Mainnet (DUST
 * UTXO never appears in wallet.state() emissions, even though the same
 * wallet sees it via scripts/check-mainnet-balance.ts). Root cause is
 * inside the SDK's interaction with the deploy import graph. Bypass it
 * by replicating the check-mainnet-balance.ts wallet build path here.
 *
 * Reads WALLET_SEED from .env.mainnet.bak (does NOT touch Preview .env).
 * Writes Mainnet contract address to .contract-address.mainnet on success.
 * Preview cron is unaffected (it uses preview.ts → cli.ts).
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Buffer } from 'node:buffer';
import { WebSocket } from 'ws';

import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';

import { createLogger } from './logger-utils.js';
import { MainnetConfig } from './config.js';
import * as api from './api.js';
import { type WalletContext } from './api.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).WebSocket = WebSocket;

const ENV_FILE = '.env.mainnet.bak';
const NETWORK_ID = 'mainnet' as const;
const CONTRACT_ADDRESS_FILE = '.contract-address.mainnet';

// Root-pruning mitigation: wait between sync-done and submit so the wallet
// observes a fresh state root that the node has not pruned yet. Mainnet
// blocks are ~6s; 8s ≈ 1.3 blocks. See docs/RESUMPTION_GUIDE.md.
const FRESH_STATE_WAIT_MS = 8_000;
const RETRY_RESYNC_WAIT_MS = 6_000;
const MAX_DEPLOY_ATTEMPTS = 3;

const waitMs = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isSubmissionError = (e: unknown): boolean => {
  if (e instanceof Error && e.message.includes('Transaction submission error')) {
    return true;
  }
  // wallet-sdk-capabilities throws Effect Data.TaggedError with _tag
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (e as any)?._tag === 'SubmissionError';
};

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
  console.log('mainnet deploy (Option F bypass)');
  console.log('========================================\n');

  // Mainnet deploy demands the admin owner public key as a CLI flag —
  // the contract enforces `assert(publicKey(localSecretKey()) == owner)` on
  // record-catch / rotate-owner, so a wrong owner here permanently locks
  // the contract. Fail fast before touching the wallet.
  const argv = process.argv.slice(2);
  const ownerFlagIdx = argv.indexOf('--initial-owner');
  const initialOwnerHex =
    ownerFlagIdx !== -1 && argv[ownerFlagIdx + 1] && !argv[ownerFlagIdx + 1].startsWith('--')
      ? argv[ownerFlagIdx + 1]
      : undefined;
  if (!initialOwnerHex) {
    throw new Error(
      'mainnet deploy requires --initial-owner <hex32>. ' +
      'Derive it with `npm run preview -- derive-owner-pk` after placing the ' +
      'admin secret key at ~/midnight/.gyotak-secrets/admin-sk.txt (chmod 600).',
    );
  }
  const initialOwnerHexClean = initialOwnerHex.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(initialOwnerHexClean)) {
    throw new Error(`--initial-owner must be 64 hex characters; got ${initialOwnerHexClean.length}`);
  }
  const initialOwner = Uint8Array.from(initialOwnerHexClean.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

  const config = new MainnetConfig(); // sets networkId='mainnet' as side-effect
  const logger = await createLogger(config.logDir);
  api.setLogger(logger);

  const t0 = Date.now();

  // Structured event log for deploy timing (root-pruning investigation).
  // NOTE: config.logDir is misleadingly named — it is the full *file* path
  // pino writes to (e.g. logs/mainnet/2026-05-05T...log). Use its parent.
  const eventLogPath = resolve(
    dirname(config.logDir),
    `deploy-events-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
  );
  try {
    mkdirSync(dirname(eventLogPath), { recursive: true });
  } catch {
    // parent dir already exists; appendFileSync below will surface real errors
  }
  const tlog = (label: string, extra?: Record<string, unknown>): void => {
    const ts = new Date().toISOString();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const suffix = extra ? ' ' + JSON.stringify(extra) : '';
    const line = `[${ts}] [+${elapsed}s] ${label}${suffix}`;
    console.log(line);
    try {
      appendFileSync(eventLogPath, line + '\n');
    } catch {
      // event log is best-effort; do not fail deploy on log write error
    }
  };

  const seed = readSeed();
  console.log(`Network:    ${NETWORK_ID}`);
  console.log(`Seed src:   ${ENV_FILE}`);
  console.log(`Indexer:    ${config.indexer}`);
  console.log(`Node:       ${config.node}`);
  console.log(`ProofSrv:   ${config.proofServer}`);
  console.log('');

  tlog('t0: script start', { network: NETWORK_ID, eventLog: eventLogPath });
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

  console.log(`Unshielded address: ${unshieldedKeystore.getBech32Address().toString()}`);
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
      // Raised 100x from 3e14 (0.3 DUST) to 3e16 (30 DUST) to avoid
      // Substrate "1016: Immediately Dropped" on Mainnet (fee priority
      // too low). SDK testkit default is 5e20 (500k DUST) but we have
      // 340k DUST so 100x bump is the safe ceiling.
      additionalFeeOverhead: 30_000_000_000_000_000n,
      feeBlocksMargin: 5,
    },
  };

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shielded: (cfg: any) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unshielded: (cfg: any) =>
      UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dust: (cfg: any) =>
      DustWallet(cfg).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      ),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  console.log('Syncing wallet (Mainnet, ~30+ min expected)...');
  process.stdout.write('Syncing');
  const tick = setInterval(() => process.stdout.write('.'), 5000);

  let exitCode = 0;
  try {
    const state = await api.waitForSync(wallet);
    clearInterval(tick);
    process.stdout.write(' done\n');

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const dustBalance = state.dust.balance(new Date());
    const dustCoins = state.dust.availableCoins.length;
    const nightBalance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    tlog('t1: sync complete', {
      syncSec: elapsed,
      dustCoins,
      dustBalance: dustBalance.toString(),
      nightBalance: nightBalance.toString(),
    });

    console.log('');
    console.log(`Sync time:    ${elapsed}s`);
    console.log(`DUST balance: ${dustBalance.toLocaleString()}  (${dustCoins} coins)`);
    console.log(`NIGHT balance: ${nightBalance.toLocaleString()}`);
    console.log('');

    if (dustCoins === 0) {
      throw new Error('Wallet has no DUST coins after sync. Cannot deploy on Mainnet.');
    }

    const ctx: WalletContext = {
      wallet,
      shieldedSecretKeys,
      dustSecretKey,
      unshieldedKeystore,
    };

    console.log('Configuring providers...');
    const providers = await api.configureProviders(ctx, config);
    console.log('Providers configured.');
    console.log('');

    // ============================================================
    // ADDITION A: Pre-submit fresh state confirmation
    // Wait 1-2 Mainnet blocks (~6s each) then re-observe wallet state
    // so the wallet surfaces a state root that post-dates sync
    // completion, mitigating Substrate root-pruning when sync ≈
    // pruning window (~256 blocks).
    // ============================================================
    tlog('A: waiting for fresh block before deploy', { waitMs: FRESH_STATE_WAIT_MS });
    await waitMs(FRESH_STATE_WAIT_MS);
    const freshState = await api.waitForSync(wallet);
    const freshDustCoins = freshState.dust.availableCoins.length;
    const freshDustBalance = freshState.dust.balance(new Date());
    tlog('t2: fresh state confirmed', {
      isSynced: freshState.isSynced,
      dustCoins: freshDustCoins,
      dustBalance: freshDustBalance.toString(),
    });
    console.log(
      `Fresh state confirmed. DUST coins: ${freshDustCoins}, balance: ${freshDustBalance.toLocaleString()}, observed at: ${new Date().toISOString()}`,
    );
    console.log('');
    if (freshDustCoins === 0) {
      throw new Error('Fresh state has no DUST coins. Cannot deploy on Mainnet.');
    }

    // ============================================================
    // ADDITION B: Retry on SubmissionError with re-sync
    // 1016 "Immediately Dropped" can be transient or root-pruning.
    // Re-syncing before each retry surfaces a fresh state root in
    // case the wallet cached a stale one between sync and submit.
    // ============================================================
    let contract: Awaited<ReturnType<typeof api.deploy>> | null = null;
    let lastErr: unknown;
    let deployElapsed = '0';
    for (let attempt = 1; attempt <= MAX_DEPLOY_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        tlog(`Retry ${attempt}/${MAX_DEPLOY_ATTEMPTS}: re-syncing wallet...`);
        console.log(
          `Retry ${attempt}/${MAX_DEPLOY_ATTEMPTS}: re-syncing wallet before re-submit...`,
        );
        await api.waitForSync(wallet);
        await waitMs(RETRY_RESYNC_WAIT_MS);
        const retryState = await api.waitForSync(wallet);
        tlog(`Retry ${attempt}/${MAX_DEPLOY_ATTEMPTS}: re-sync complete`, {
          dustCoins: retryState.dust.availableCoins.length,
          dustBalance: retryState.dust.balance(new Date()).toString(),
        });
      }

      console.log(
        attempt === 1
          ? 'Deploying gyotak-catch contract on Mainnet...'
          : `Deploying gyotak-catch contract on Mainnet (attempt ${attempt}/${MAX_DEPLOY_ATTEMPTS})...`,
      );
      console.log('(ZK proof generation + on-chain submit; expect 1-3 min)');
      tlog('t3: ZK proof start (Deploying...)', { attempt });
      const deployStart = Date.now();
      try {
        contract = await api.deploy(providers, initialOwner);
        deployElapsed = ((Date.now() - deployStart) / 1000).toFixed(1);
        tlog('t4: submit complete', {
          attempt,
          deploySec: deployElapsed,
          txId: contract.deployTxData.public.txId,
          blockHeight: String(contract.deployTxData.public.blockHeight),
        });
        break;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const submission = isSubmissionError(e);
        tlog('t4: submit failed', {
          attempt,
          deploySec: ((Date.now() - deployStart) / 1000).toFixed(1),
          isSubmissionError: submission,
          message: msg,
        });
        if (!submission || attempt === MAX_DEPLOY_ATTEMPTS) {
          throw e;
        }
        console.log(
          `Submit failed (attempt ${attempt}/${MAX_DEPLOY_ATTEMPTS}): ${msg}. Will re-sync and retry.`,
        );
      }
    }
    if (!contract) {
      throw lastErr instanceof Error ? lastErr : new Error('Deploy failed without explicit error');
    }

    const contractAddress = contract.deployTxData.public.contractAddress;
    const blockHeight = contract.deployTxData.public.blockHeight;
    const txId = contract.deployTxData.public.txId;

    console.log('');
    console.log('========================================');
    console.log('  ✓ Mainnet contract DEPLOYED');
    console.log('========================================');
    console.log(`Contract addr:  ${contractAddress}`);
    console.log(`Block height:   ${blockHeight}`);
    console.log(`TX ID:          ${txId}`);
    console.log(`Deploy time:    ${deployElapsed}s`);
    console.log('========================================');
    console.log('');

    writeFileSync(resolve(process.cwd(), CONTRACT_ADDRESS_FILE), contractAddress);
    console.log(`Saved contract address to ${CONTRACT_ADDRESS_FILE}`);
  } catch (e) {
    clearInterval(tick);
    console.log('');
    tlog('FAILED: deploy unrecoverable', {
      message: e instanceof Error ? e.message : String(e),
    });
    console.error(
      `DEPLOY FAILED: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
    );
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
