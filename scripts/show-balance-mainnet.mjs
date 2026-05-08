// show-balance-mainnet.mjs (READ-ONLY, Mainnet)
//
// Mirrors scripts/show-balance.mjs but:
//   - reads WALLET_SEED from .env.mainnet.bak  (does NOT touch .env)
//   - targets indexer.mainnet.midnight.network / rpc.mainnet.midnight.network
//   - uses /api/v4/graphql (matches MainnetConfig in src/config.ts)
//   - networkId = 'mainnet'
// No transactions are submitted; only wallet sync + balance read.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';

// eslint-disable-next-line no-undef
globalThis.WebSocket = WebSocket;

const NETWORK_ID = 'mainnet';
const INDEXER = 'https://indexer.mainnet.midnight.network/api/v4/graphql';
const INDEXER_WS = 'wss://indexer.mainnet.midnight.network/api/v4/graphql/ws';
const NODE = 'https://rpc.mainnet.midnight.network';
const PROOF_SERVER = 'http://127.0.0.1:6300';
const ENV_FILE = '.env.mainnet.bak';

const readSeed = () => {
  const raw = readFileSync(resolve(process.cwd(), ENV_FILE), 'utf8');
  for (const line of raw.split('\n')) {
    if (line.startsWith('WALLET_SEED=')) {
      return line.slice('WALLET_SEED='.length).trim();
    }
  }
  throw new Error(`WALLET_SEED not found in ${ENV_FILE}`);
};

const seedHex = readSeed();

const hd = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
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

console.log(`Network:             ${NETWORK_ID}`);
console.log(`Seed source:         ${ENV_FILE}`);
console.log(`Indexer:             ${INDEXER}`);
console.log(`Node:                ${NODE}`);
console.log(`Unshielded address:  ${unshieldedKeystore.getBech32Address().toString()}`);
console.log('');

const indexerClientConnection = { indexerHttpUrl: INDEXER, indexerWsUrl: INDEXER_WS };

const shieldedConfig = {
  networkId: NETWORK_ID,
  indexerClientConnection,
  provingServerUrl: new URL(PROOF_SERVER),
  relayURL: new URL(NODE.replace(/^http/, 'ws')),
};
const unshieldedConfig = {
  networkId: NETWORK_ID,
  indexerClientConnection,
  txHistoryStorage: new InMemoryTransactionHistoryStorage(),
};
const dustConfig = {
  networkId: NETWORK_ID,
  costParameters: {
    additionalFeeOverhead: 300_000_000_000_000n,
    feeBlocksMargin: 5,
  },
  indexerClientConnection,
  provingServerUrl: new URL(PROOF_SERVER),
  relayURL: new URL(NODE.replace(/^http/, 'ws')),
};

const walletConfig = { ...shieldedConfig, ...unshieldedConfig, ...dustConfig };

const wallet = await WalletFacade.init({
  configuration: walletConfig,
  shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
  unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
  dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
});
await wallet.start(shieldedSecretKeys, dustSecretKey);

process.stdout.write('Syncing');
const tick = setInterval(() => process.stdout.write('.'), 2000);

const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
clearInterval(tick);
process.stdout.write(' done\n');

const nightRaw = unshieldedToken().raw;
const nightBalance = state.unshielded.balances[nightRaw] ?? 0n;
const dustBalance = state.dust.balance(new Date());
const nightCoins = state.unshielded.availableCoins.length;
const registeredNight = state.unshielded.availableCoins.filter(
  (c) => c.meta?.registeredForDustGeneration === true,
).length;
const dustCoins = state.dust.availableCoins.length;

console.log('');
console.log(`NIGHT balance:       ${nightBalance.toLocaleString()}  (${nightCoins} coins, ${registeredNight} registered for dust)`);
console.log(`DUST balance:        ${dustBalance.toLocaleString()}  (${dustCoins} coins)`);

await wallet.stop();
shieldedSecretKeys.clear();
dustSecretKey.clear();
