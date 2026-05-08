/*
 * check-orphan.ts (READ-ONLY)
 *
 * Purpose:
 *   Query Midnight ledger state to determine whether the orphan D1 row
 *   (id=13377424-40eb-4af6-a3f8-061ffe69ad29, batch_id=CR-20260427-3efd2852)
 *   exists on-chain. Stuck in midnight_status='submitting' since the PC reboot.
 *
 * Behavior:
 *   - Read-only. Does NOT touch D1, does NOT submit any TX.
 *   - Calls api.getCatchLedgerState() — same path the apply-side of
 *     realign-d1-with-chain.ts uses for verification.
 *   - Prints "FOUND" with on-chain photoHash + region/catchDate/fishSpecies
 *     and committedAt if the batch_id is present, "NOT FOUND" otherwise.
 *   - Compares on-chain photoHash to the D1 image_hash for sanity.
 *
 * Usage:
 *   cd ~/midnight/gyotak-catch
 *   node --no-warnings --loader ts-node/esm scripts/check-orphan.ts
 */
import { PreviewConfig } from '../src/config.js';
import { createLogger } from '../src/logger-utils.js';
import * as api from '../src/api.js';
import {
  readSeed,
  readContractAddress,
  textToBytes32,
  hexFromBytes,
  bytes32ToAscii,
} from '../src/cli.js';

const ORPHAN_BATCH_ID = 'CR-20260427-3efd2852';
const ORPHAN_IMAGE_HASH =
  '8f36e41660a5993176bd3645e1e84c2107cfdb6cb329b81a5c33fdcd2c371c20';
const ORPHAN_ROW_ID = '13377424-40eb-4af6-a3f8-061ffe69ad29';

const main = async (): Promise<number> => {
  console.log('========================================');
  console.log('check-orphan  (READ-ONLY, no writes)');
  console.log(`row_id:   ${ORPHAN_ROW_ID}`);
  console.log(`batch_id: ${ORPHAN_BATCH_ID}`);
  console.log(`d1 image_hash: ${ORPHAN_IMAGE_HASH}`);
  console.log('========================================\n');

  const config = new PreviewConfig();
  const logger = await createLogger(config.logDir);
  api.setLogger(logger);
  const walletCtx = await api.buildWalletAndWaitForFunds(config, readSeed());
  try {
    const providers = await api.configureProviders(walletCtx, config);
    const contractAddress = readContractAddress();
    const batchHex = hexFromBytes(textToBytes32(ORPHAN_BATCH_ID));
    console.log(`contract: ${contractAddress}`);
    console.log(`batch_id_hex: ${batchHex}\n`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = await api.getCatchLedgerState(providers, contractAddress as any, batchHex);
    if (!rec) {
      console.log('RESULT: NOT FOUND');
      console.log('  → batch_id is NOT present in contract ledger state.');
      console.log('  → Safe to revert D1 row to midnight_status=pending; cron will re-submit.');
      return 0;
    }

    const onChainPhotoHashHex = hexFromBytes(rec.photoHash);
    const photoHashMatches = onChainPhotoHashHex === ORPHAN_IMAGE_HASH;

    console.log('RESULT: FOUND');
    console.log(`  on-chain photoHash:   ${onChainPhotoHashHex}`);
    console.log(`  d1 image_hash:        ${ORPHAN_IMAGE_HASH}`);
    console.log(`  photoHash matches:    ${photoHashMatches ? 'YES' : 'NO (MISMATCH — investigate!)'}`);
    console.log(`  on-chain region:      ${bytes32ToAscii(rec.region)}`);
    console.log(`  on-chain catchDate:   ${bytes32ToAscii(rec.catchDate)}`);
    console.log(`  on-chain fishSpecies: ${bytes32ToAscii(rec.fishSpecies)}`);
    console.log(`  on-chain committedAt: ${rec.committedAt.toString()}`);
    console.log('');
    console.log('  → batch_id IS on-chain. TX completed before PC reboot.');
    console.log('  → Safe to mark D1 row as confirmed (tx_hash/block_number stay NULL — not in ledger state).');
    return 0;
  } finally {
    await walletCtx.wallet.stop();
  }
};

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(
      `fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
    );
    process.exit(1);
  });
