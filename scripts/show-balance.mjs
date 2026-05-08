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
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { NoOpTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';

// eslint-disable-next-line no-undef
globalThis.WebSocket = WebSocket;

// Usage: node scripts/show-balance.mjs [preview|preprod|mainnet]
// Defaults to 'preview' for backward compatibility.
const NETWORK_ID = process.argv[2] || 'preview';
const DOMAIN = NETWORK_ID; // 'preview' | 'preprod' | 'mainnet' all map directly
const INDEXER = process.env.INDEXER_URI ?? `https://indexer.${DOMAIN}.midnight.network/api/v4/graphql`;
const INDEXER_WS = process.env.INDEXER_WS_URI ?? `wss://indexer.${DOMAIN}.midnight.network/api/v4/graphql/ws`;
const NODE = process.env.NODE_URI ?? `https://rpc.${DOMAIN}.midnight.network`;
const PROOF_SERVER =
  process.env.PROOF_SERVER_URI ??
  (NETWORK_ID === 'preprod'
    ? 'https://lace-proof-pub.preprod.midnight.network'
    : 'http://127.0.0.1:6300');

const readSeed = () => {
  const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  for (const line of raw.split('\n')) {
    if (line.startsWith('WALLET_SEED=')) {
      return line.slice('WALLET_SEED='.length).trim();
    }
  }
  throw new Error('WALLET_SEED not found in .env');
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
  txHistoryStorage: new NoOpTransactionHistoryStorage(),
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
console.log(`Network:             ${NETWORK_ID}`);
console.log(`Unshielded address:  ${unshieldedKeystore.getBech32Address().toString()}`);
console.log(`NIGHT balance:       ${nightBalance.toLocaleString()} tNIGHT  (${nightCoins} coins, ${registeredNight} registered for dust)`);
console.log(`DUST balance:        ${dustBalance.toLocaleString()} tDUST   (${dustCoins} coins)`);

await wallet.stop();
shieldedSecretKeys.clear();
dustSecretKey.clear();
