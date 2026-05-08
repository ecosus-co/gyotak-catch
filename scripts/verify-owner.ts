// Verify on-chain ledger.owner against expected pubkey.
// Reads the deployed contract state via the Preprod indexer and compares
// owner to the supplied 64-hex pk. Read-only: no chain writes, no DUST.
//
// Exit codes:
//   0 = byte-for-byte match
//   1 = bad arguments
//   2 = contract not found on indexer
//   3 = mismatch (owner != expected)
import { PreprodConfig } from '../src/config.js';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { ledger } from '../contracts/managed/contract/index.js';

const CONTRACT_ADDRESS = process.argv[2];
const EXPECTED_PK_HEX = process.argv[3];

if (!CONTRACT_ADDRESS || !EXPECTED_PK_HEX) {
  process.stderr.write('Usage: verify-owner.ts <contract-address> <expected-pk-hex>\n');
  process.exit(1);
}

const cfg = new PreprodConfig(); // setNetworkId('preprod') as side-effect
const p = indexerPublicDataProvider(cfg.indexer, cfg.indexerWS);

const state = await p.queryContractState(CONTRACT_ADDRESS);
if (state == null) {
  process.stderr.write(`STOP: contract ${CONTRACT_ADDRESS} not found on Preprod indexer\n`);
  process.exit(2);
}

const decoded = ledger(state.data);
const onchainOwner = Buffer.from(decoded.owner).toString('hex');

console.log(`contract address: ${CONTRACT_ADDRESS}`);
console.log(`on-chain owner:   ${onchainOwner}`);
console.log(`expected pk:      ${EXPECTED_PK_HEX}`);

if (onchainOwner === EXPECTED_PK_HEX) {
  console.log('OK: match — Score-1 owner gate is correctly initialized on-chain');
  process.exit(0);
} else {
  console.log('MISMATCH — owner gate would reject all subsequent recordCatch / rotateOwner');
  process.exit(3);
}
