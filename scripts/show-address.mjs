import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ZswapSecretKeys } from '@midnight-ntwrk/ledger-v8';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';

// Usage: node scripts/show-address.mjs [preview|preprod|mainnet]
// Defaults to 'preview' for backward compatibility.
const NETWORK_ID = process.argv[2] || 'preview';

const readSeed = () => {
  const envPath = resolve(process.cwd(), '.env');
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    if (line.startsWith('WALLET_SEED=')) {
      return line.slice('WALLET_SEED='.length).trim();
    }
  }
  throw new Error('WALLET_SEED not found in .env');
};

const seedHex = readSeed();

const hd = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
if (hd.type !== 'seedOk') {
  throw new Error('HDWallet.fromSeed failed');
}

const derived = hd.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
  .deriveKeysAt(0);
if (derived.type !== 'keysDerived') {
  throw new Error('deriveKeysAt failed');
}

const zswapKeys = ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);
const unshieldedKeystore = createKeystore(derived.keys[Roles.NightExternal], NETWORK_ID);

const unshieldedAddress = unshieldedKeystore.getBech32Address().toString();

const coinPk = ShieldedCoinPublicKey.fromHexString(zswapKeys.coinPublicKey);
const encPk = ShieldedEncryptionPublicKey.fromHexString(zswapKeys.encryptionPublicKey);
const shieldedAddress = MidnightBech32m.encode(NETWORK_ID, new ShieldedAddress(coinPk, encPk)).toString();

hd.hdWallet.clear();
zswapKeys.clear();

console.log(`Network: ${NETWORK_ID}`);
console.log('Unshielded address (fund this with tNIGHT from faucet):');
console.log(`  ${unshieldedAddress}`);
console.log('Shielded address (for reference only):');
console.log(`  ${shieldedAddress}`);
