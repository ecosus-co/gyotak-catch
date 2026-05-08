/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import {
  type FinalizedTxData,
  type MidnightProvider,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js/types';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js/utils';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

import { Contract, ledger as gyotakCatchLedger } from '../contracts/managed/contract/index.js';
import { initialPrivateState, witnesses, type GyotakCatchPrivateState } from './witnesses.js';
import {
  GyotakCatchPrivateStateId,
  type GyotakCatchCircuits,
  type GyotakCatchContract,
  type GyotakCatchProviders,
  type DeployedGyotakCatchContract,
} from './common-types.js';
import { type Config, contractConfig } from './config.js';

let logger: Logger;

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

const gyotakCatchCompiledContract = CompiledContract.make('gyotak-catch', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

export const gyotakCatchContractInstance: GyotakCatchContract = new Contract<GyotakCatchPrivateState, typeof witnesses>(witnesses);

export type CatchRecordView = {
  gpsHash: Uint8Array;
  photoHash: Uint8Array;
  region: Uint8Array;
  catchDate: Uint8Array;
  fishSpecies: Uint8Array;
  committedAt: bigint;
};

export const getCatchLedgerState = async (
  providers: GyotakCatchProviders,
  contractAddress: ContractAddress,
  batchIdHex: string,
): Promise<CatchRecordView | null> => {
  assertIsContractAddress(contractAddress);
  logger.info({ contractAddress, batchIdHex }, 'Checking catch ledger state...');
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  if (contractState == null) return null;
  const state = gyotakCatchLedger(contractState.data);
  const keyBytes = Buffer.from(batchIdHex, 'hex');
  if (!state.batches.member(keyBytes)) return null;
  return state.batches.lookup(keyBytes) as CatchRecordView;
};

export const joinContract = async (
  providers: GyotakCatchProviders,
  contractAddress: string,
): Promise<DeployedGyotakCatchContract> => {
  const contract = await findDeployedContract<GyotakCatchContract>(providers, {
    contractAddress,
    compiledContract: gyotakCatchCompiledContract,
    privateStateId: GyotakCatchPrivateStateId,
    initialPrivateState,
  });
  logger.info(`Joined contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract;
};

export const deploy = async (
  providers: GyotakCatchProviders,
  initialOwner: Uint8Array,
  privateState: GyotakCatchPrivateState = initialPrivateState,
): Promise<DeployedGyotakCatchContract> => {
  if (!(initialOwner instanceof Uint8Array) || initialOwner.length !== 32) {
    throw new Error('deploy: initialOwner must be a Uint8Array of length 32');
  }
  logger.info({ initialOwner: toHex(initialOwner) }, 'Deploying gyotak-catch contract...');
  const contract = await deployContract<GyotakCatchContract>(providers, {
    compiledContract: gyotakCatchCompiledContract,
    privateStateId: GyotakCatchPrivateStateId,
    initialPrivateState: privateState,
    args: [initialOwner],
  } as any);
  logger.info(`Deployed contract at address: ${contract.deployTxData.public.contractAddress}`);
  return contract;
};

export const rotateOwner = async (
  contract: DeployedGyotakCatchContract,
  newOwner: Uint8Array,
): Promise<FinalizedTxData> => {
  if (!(newOwner instanceof Uint8Array) || newOwner.length !== 32) {
    throw new Error('rotateOwner: newOwner must be a Uint8Array of length 32');
  }
  logger.info({ newOwner: toHex(newOwner) }, 'rotateOwner...');
  const finalizedTxData = await (contract as any).callTx.rotateOwner(newOwner);
  logger.info(
    `Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`,
  );
  return finalizedTxData.public;
};

export const recordCatch = async (
  contract: DeployedGyotakCatchContract,
  batchId: Uint8Array,
  region: Uint8Array,
  catchDate: Uint8Array,
  fishSpecies: Uint8Array,
  photoHash: Uint8Array,
  timestamp: bigint,
): Promise<FinalizedTxData> => {
  logger.info({ batchId: toHex(batchId) }, 'recordCatch...');
  const finalizedTxData = await (contract as any).callTx.recordCatch(
    batchId,
    region,
    catchDate,
    fishSpecies,
    photoHash,
    timestamp,
  );
  logger.info(
    `Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`,
  );
  return finalizedTxData.public;
};

export const verifyCatch = async (
  contract: DeployedGyotakCatchContract,
  batchId: Uint8Array,
): Promise<{ txData: FinalizedTxData; record: CatchRecordView }> => {
  logger.info({ batchId: toHex(batchId) }, 'verifyCatch...');
  const finalizedTxData = await (contract as any).callTx.verifyCatch(batchId);
  logger.info(
    `Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`,
  );
  return {
    txData: finalizedTxData.public,
    record: finalizedTxData.private.result as CatchRecordView,
  };
};

/**
 * Sign all unshielded offers in a transaction's intents, using the correct
 * proof marker for Intent.deserialize. Works around a bug in the wallet SDK
 * where signRecipe hardcodes 'pre-proof', which fails for proven
 * (UnboundTransaction) intents that contain 'proof' data.
 */
const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
      intent.serialize(),
    );

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    tx.intents.set(segment, cloned);
  }
};

export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );

      const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      }

      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx) {
      return ctx.wallet.submitTransaction(tx) as any;
    },
  };
};

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((state) => state.isSynced),
      Rx.filter((state) =>
        state.dust.availableCoins.length > 0 ||
        (state.unshielded.balances[unshieldedToken().raw] ?? 0n) > 0n,
      ),
    ),
  );

export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((state) => state.isSynced),
      Rx.map((s) => s.dust.balance(new Date())),
      Rx.filter((balance) => balance > 0n),
    ),
  );

const buildShieldedConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

const buildUnshieldedConfig = ({ indexer, indexerWS }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  txHistoryStorage: new NoOpTransactionHistoryStorage(),
});

const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  costParameters: {
    additionalFeeOverhead: 300_000_000_000_000n,
    feeBlocksMargin: 5,
  },
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet from seed');
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys');
  }

  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

const formatBalance = (balance: bigint): string => balance.toLocaleString();

export const withStatus = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]} ${message}`);
  }, 80);
  try {
    const result = await fn();
    clearInterval(interval);
    process.stdout.write(`\r  ✓ ${message}\n`);
    return result;
  } catch (e) {
    clearInterval(interval);
    process.stdout.write(`\r  ✗ ${message}\n`);
    throw e;
  }
};

const registerForDustGeneration = async (
  wallet: WalletFacade,
  unshieldedKeystore: UnshieldedKeystore,
): Promise<void> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));

  if (state.dust.availableCoins.length > 0) {
    const dustBal = state.dust.balance(new Date());
    console.log(`  ✓ Dust tokens already available (${formatBalance(dustBal)} DUST)`);
    return;
  }

  const nightUtxos = state.unshielded.availableCoins.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (nightUtxos.length === 0) {
    await withStatus('Waiting for dust tokens to generate', () =>
      Rx.firstValueFrom(
        wallet.state().pipe(
          Rx.throttleTime(5_000),
          Rx.filter((s) => s.isSynced),
          Rx.filter((s) => s.dust.balance(new Date()) > 0n),
        ),
      ),
    );
    return;
  }

  await withStatus(`Registering ${nightUtxos.length} NIGHT UTXO(s) for dust generation`, async () => {
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
    );
    const finalized = await wallet.finalizeRecipe(recipe);
    await wallet.submitTransaction(finalized);
  });

  await withStatus('Waiting for dust tokens to generate', () =>
    Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    ),
  );
};

const printWalletSummary = (state: any, unshieldedKeystore: UnshieldedKeystore) => {
  const networkId = getNetworkId();
  const unshieldedBalance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;

  const coinPubKey = ShieldedCoinPublicKey.fromHexString(state.shielded.coinPublicKey.toHexString());
  const encPubKey = ShieldedEncryptionPublicKey.fromHexString(state.shielded.encryptionPublicKey.toHexString());
  const shieldedAddress = MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey, encPubKey)).toString();

  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId}
${DIV}

  Shielded (ZSwap)
  └─ Address: ${shieldedAddress}

  Unshielded
  ├─ Address: ${unshieldedKeystore.getBech32Address()}
  └─ Balance: ${formatBalance(unshieldedBalance)} tNight

  Dust
  └─ Address: ${MidnightBech32m.encode(networkId, state.dust.address).toString()}

${DIV}`);
};

// Wallet sync state persistence — only active when config.walletStateDir is set.
// Files: shielded.json / unshielded.json / dust.json. All-or-nothing semantics:
// restore happens only if all three files exist (otherwise we fall back to fresh
// start to avoid mismatched state across the three sub-wallets).
const STATE_FILES = {
  shielded: 'shielded.json',
  unshielded: 'unshielded.json',
  dust: 'dust.json',
} as const;

const tryReadWalletState = (
  dir: string | undefined,
  filename: string,
): string | null => {
  if (!dir) return null;
  const p = pathResolve(dir, filename);
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

export const saveWalletStates = async (
  wallet: WalletFacade,
  dir: string | undefined,
): Promise<void> => {
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const [s, u, d] = await Promise.all([
      wallet.shielded.serializeState(),
      wallet.unshielded.serializeState(),
      wallet.dust.serializeState(),
    ]);
    writeFileSync(pathResolve(dir, STATE_FILES.shielded), s);
    writeFileSync(pathResolve(dir, STATE_FILES.unshielded), u);
    writeFileSync(pathResolve(dir, STATE_FILES.dust), d);
    if (logger) {
      logger.info({ dir }, 'wallet state persisted');
    }
  } catch (e) {
    // Best-effort persistence; never fail the deploy/record on save error.
    if (logger) {
      logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'wallet state save failed',
      );
    }
  }
};

export const buildWalletAndWaitForFunds = async (config: Config, seed: string): Promise<WalletContext> => {
  console.log('');
  const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await withStatus(
    'Building wallet',
    async () => {
      const keys = deriveKeysFromSeed(seed);
      const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
      const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
      const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

      const walletConfig = {
        ...buildShieldedConfig(config),
        ...buildUnshieldedConfig(config),
        ...buildDustConfig(config),
      };

      // Persistence: restore only when ALL THREE saved files are present.
      // Mismatched/partial restore would corrupt cross-wallet invariants.
      const savedShielded = tryReadWalletState(config.walletStateDir, STATE_FILES.shielded);
      const savedUnshielded = tryReadWalletState(config.walletStateDir, STATE_FILES.unshielded);
      const savedDust = tryReadWalletState(config.walletStateDir, STATE_FILES.dust);
      const restoring = !!(savedShielded && savedUnshielded && savedDust);
      if (restoring) {
        console.log(`[wallet] Restoring saved state from ${config.walletStateDir}`);
      } else if (config.walletStateDir) {
        console.log(`[wallet] No saved state at ${config.walletStateDir}; fresh start`);
      }

      const wallet = await WalletFacade.init({
        configuration: walletConfig,
        shielded: (cfg) =>
          restoring
            ? ShieldedWallet(cfg).restore(savedShielded!)
            : ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
        unshielded: (cfg) =>
          restoring
            ? UnshieldedWallet(cfg).restore(savedUnshielded!)
            : UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
        dust: (cfg) =>
          restoring
            ? DustWallet(cfg).restore(savedDust!)
            : DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
      });
      await wallet.start(shieldedSecretKeys, dustSecretKey);

      return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
    },
  );

  const networkId = getNetworkId();
  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId}
${DIV}
  Unshielded Address (send tNight here):
  ${unshieldedKeystore.getBech32Address()}
${DIV}
`);

  console.log('[deploy] Starting wallet sync (no spinner wrap)...');
  const syncStartTime = Date.now();
  let emissionCount = 0;
  const syncedState = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((s) => {
        emissionCount += 1;
        const elapsed = ((Date.now() - syncStartTime) / 1000).toFixed(1);
        const night = s.unshielded.balances[unshieldedToken().raw] ?? 0n;
        console.log(
          `[sync emission #${emissionCount} t=${elapsed}s] isSynced=${s.isSynced} ` +
          `dust.coins=${s.dust.availableCoins.length} night=${night}`,
        );
      }),
      Rx.filter((s) => s.isSynced),
      Rx.filter((s) =>
        s.dust.availableCoins.length > 0 ||
        (s.unshielded.balances[unshieldedToken().raw] ?? 0n) > 0n,
      ),
    ),
  );
  console.log(`[deploy] Sync complete in ${((Date.now() - syncStartTime) / 1000).toFixed(1)}s after ${emissionCount} emissions`);
  // Persist sync checkpoint so subsequent runs can `restore` and skip the
  // multi-hour cold sync (relevant on Preprod). No-op when walletStateDir unset.
  await saveWalletStates(wallet, config.walletStateDir);
  printWalletSummary(syncedState, unshieldedKeystore);

  const dustCoins = syncedState.dust.availableCoins.length;
  const dustBalance = syncedState.dust.balance(new Date());
  if (dustCoins > 0) {
    console.log(`    DUST present: ${formatBalance(dustBalance)} (${dustCoins} coins)\n`);
  }
  // registerForDustGeneration handles BOTH NIGHT registration (when needed) AND
  // the wait-for-DUST step internally. Calling it directly avoids the deadlock
  // where the prior outer waitForFunds blocked on dust.balance>0 *before*
  // NIGHT registration ran — fatal on a fresh wallet whose only resource is
  // unregistered NIGHT (Preprod attempt2, 2026-05-07).
  await registerForDustGeneration(wallet, unshieldedKeystore);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const buildFreshWallet = async (config: Config): Promise<WalletContext> => {
  const seed = toHex(Buffer.from(generateRandomSeed()));
  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`
${DIV}
  New Wallet Seed — save this before continuing
${DIV}
  ${seed}
${DIV}
`);
  return await buildWalletAndWaitForFunds(config, seed);
};

export const configureProviders = async (ctx: WalletContext, config: Config): Promise<GyotakCatchProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<GyotakCatchCircuits>(contractConfig.zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, 'hex').toString('base64')}!`;
  return {
    privateStateProvider: levelPrivateStateProvider<typeof GyotakCatchPrivateStateId, GyotakCatchPrivateState>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

export function setLogger(_logger: Logger) {
  logger = _logger;
}
