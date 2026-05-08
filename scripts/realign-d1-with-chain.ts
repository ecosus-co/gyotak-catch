/*
 * realign-d1-with-chain.ts (ONE-SHOT, DO NOT ADD TO CRON)
 *
 * Purpose:
 *   Fix 4 rows in catch_report_images whose D1 state does not match Midnight
 *   on-chain reality. See docs/CHANGELOG.md — 2026-04-21 Phase 2-Step 2.
 *
 *   3 rows (0cbe346d img1, 7559d7df img1, 7559d7df img2) have
 *   midnight_status='failed' + midnight_error='catch already exists' but their
 *   midnight_tx_hash / midnight_block_number / midnight_confirmed_at are already
 *   populated from a prior successful markConfirmed — i.e. they ARE on-chain
 *   (verified by log logs/preview/2026-04-21T06:30:33.809Z.log) but D1 is lying.
 *
 *   1 row (b8037b5c img1) was submitted via `cli record-catch` manually on
 *   2026-04-20 23:48 UTC (logs/preview/2026-04-20T23:41:52.346Z.log, tx
 *   00b2241826…, block 387984). Since cli has no D1 write-back (cause A),
 *   the row still shows status='pending', batch_id=null, no tx info.
 *
 * Usage:
 *   (dry-run — default)
 *   export CF_API_TOKEN=$(grep ^CF_API_TOKEN .env | cut -d= -f2-)
 *   node --no-warnings --loader ts-node/esm scripts/realign-d1-with-chain.ts
 *
 *   (apply)
 *   node --no-warnings --loader ts-node/esm scripts/realign-d1-with-chain.ts --apply
 *
 * Safety:
 *   - Dry-run by default. --apply required to write.
 *   - UPDATE guarded by (id=? AND image_hash LIKE prefix%) — typo-proof.
 *   - After --apply, re-fetches each row via Worker API and queries the contract
 *     via getCatchLedgerState to confirm the recorded photoHash on-chain matches
 *     the image_hash we just wrote to D1.
 */
import { PreviewConfig } from '../src/config.js';
import { createLogger } from '../src/logger-utils.js';
import * as api from '../src/api.js';
import {
  readSeed,
  readContractAddress,
  textToBytes32,
  hexFromBytes,
} from '../src/cli.js';
import type { GyotakCatchProviders } from '../src/common-types.js';

const CF_ACCOUNT_ID = '3f77cb87bd4075a1a60b7ee7aff41947';
const CF_DATABASE_ID = '03134e75-87c3-49a1-a9a0-93474911ac52';
const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_DATABASE_ID}/query`;
const WORKER_BASE = 'https://line-harness.gyotak.workers.dev/gyotak';

// Worker auth token (was hardcoded; moved to env var 2026-05-09 for public release).
// Required at module init when this script is run; missing env aborts before any work.
const WORKER_TOKEN = process.env.WORKER_TOKEN;
if (!WORKER_TOKEN) {
  throw new Error('WORKER_TOKEN env var is required (add it to .env)');
}

interface RealignFields {
  batch_id?: string;
  midnight_tx_hash?: string;
  midnight_block_number?: number;
  midnight_confirmed_at?: number;
  // status is always set to 'confirmed'; error is always set to NULL.
}

interface RealignTarget {
  image_row_id: string;
  catch_report_id: string;
  image_hash_prefix: string;
  batch_id_expected: string; // used for on-chain verification
  fields: RealignFields;
  source_notes: string;
}

const TARGETS: RealignTarget[] = [
  {
    image_row_id: 'c6a422d3-749f-4a5f-aa93-aa7735c93fbc',
    catch_report_id: 'b8037b5c-9149-475b-8df7-4761c7a3bde5',
    image_hash_prefix: '63116038094ee6f0',
    batch_id_expected: 'CR-20260420-b8037b5c',
    fields: {
      batch_id: 'CR-20260420-b8037b5c',
      midnight_tx_hash:
        '00b2241826a0ca158766a28f2dbbdb77de420bcaf55e91899dcf98575855a14214',
      midnight_block_number: 387984,
      midnight_confirmed_at: 1776728905544,
    },
    source_notes:
      'logs/preview/2026-04-20T23:41:52.346Z.log — manual `cli record-catch` (cause A). Contract has it; D1 never written.',
  },
  {
    image_row_id: 'c48ed166-0daa-4909-a315-8006a3af135e',
    catch_report_id: '0cbe346d-b818-4eb6-87c8-7a6af799ca36',
    image_hash_prefix: '0ec3aae64cf8f334',
    batch_id_expected: 'CR-20260421-b49839c9',
    fields: {}, // tx/block/confirmed_at already in D1 (from earlier markConfirmed); only need status+error.
    source_notes:
      'logs/preview/2026-04-21T06:30:33.809Z.log — mirror-pending confirmed, cause C reset, re-submit failed with "catch already exists". On-chain.',
  },
  {
    image_row_id: '067a19d4-8247-4f2b-b897-73d1d0102f6b',
    catch_report_id: '7559d7df-3721-4174-813c-669ad0cb4379',
    image_hash_prefix: '294bee16911d25e2',
    batch_id_expected: 'CR-20260421-d22e8d85',
    fields: {},
    source_notes:
      'Same as 0cbe346d row — mirror-pending confirmed, cause C reset, re-submit failed. On-chain (block 392119).',
  },
  {
    image_row_id: 'ff588f96-c4cb-4fba-9752-ad722e5356b2',
    catch_report_id: '7559d7df-3721-4174-813c-669ad0cb4379',
    image_hash_prefix: '7fd3bf24b79742d5',
    batch_id_expected: 'CR-20260421-d8f6b8fe',
    fields: {},
    source_notes:
      'Same as 0cbe346d row — mirror-pending confirmed, cause C reset, re-submit failed. On-chain (block 392125).',
  },
];

const d1Query = async <T = unknown>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => {
  const token = process.env.CF_API_TOKEN;
  if (!token) throw new Error('CF_API_TOKEN is not set (add it to .env).');
  const res = await fetch(D1_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`D1 HTTP ${res.status}: ${bodyText}`);
  const body = JSON.parse(bodyText) as {
    success: boolean;
    errors?: Array<{ message: string }>;
    result?: Array<{ results: T[] }>;
  };
  if (!body.success) {
    const msg =
      body.errors?.map((e) => e.message).join('; ') ?? 'unknown D1 error';
    throw new Error(`D1 query failed: ${msg}`);
  }
  return body.result?.[0]?.results ?? [];
};

interface ImageSnapshot {
  id: string;
  image_hash: string;
  batch_id: string | null;
  midnight_tx_hash: string | null;
  midnight_block_number: number | null;
  midnight_status: string;
  midnight_submitted_at: number | null;
  midnight_confirmed_at: number | null;
  midnight_error: string | null;
}

const fetchCurrentImageState = async (
  catch_report_id: string,
  image_row_id: string,
): Promise<ImageSnapshot | null> => {
  const res = await fetch(`${WORKER_BASE}/catch-reports/${catch_report_id}`, {
    headers: { Authorization: `Bearer ${WORKER_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Worker API HTTP ${res.status}`);
  const body = (await res.json()) as {
    report?: { images?: ImageSnapshot[] };
  };
  return body.report?.images?.find((img) => img.id === image_row_id) ?? null;
};

const truncate = (s: string, max = 80): string =>
  s.length > max ? s.slice(0, max) + '...' : s;

const formatSnapshot = (s: ImageSnapshot | null): string => {
  if (!s) return '    (row not found)';
  return [
    `    row_id:                ${s.id}`,
    `    image_hash:            ${s.image_hash}`,
    `    batch_id:              ${s.batch_id ?? '(null)'}`,
    `    midnight_status:       ${s.midnight_status}`,
    `    midnight_tx_hash:      ${s.midnight_tx_hash ?? '(null)'}`,
    `    midnight_block_number: ${s.midnight_block_number ?? '(null)'}`,
    `    midnight_submitted_at: ${s.midnight_submitted_at ?? '(null)'}`,
    `    midnight_confirmed_at: ${s.midnight_confirmed_at ?? '(null)'}`,
    `    midnight_error:        ${s.midnight_error ? truncate(s.midnight_error) : '(null)'}`,
  ].join('\n');
};

const diffToPlan = (
  before: ImageSnapshot | null,
  target: RealignTarget,
): string => {
  const lines: string[] = [];
  const f = target.fields;
  if (f.batch_id !== undefined && before?.batch_id !== f.batch_id) {
    lines.push(
      `    batch_id:              ${before?.batch_id ?? '(null)'} → ${f.batch_id}`,
    );
  }
  if (
    f.midnight_tx_hash !== undefined &&
    before?.midnight_tx_hash !== f.midnight_tx_hash
  ) {
    lines.push(
      `    midnight_tx_hash:      ${before?.midnight_tx_hash ?? '(null)'} → ${f.midnight_tx_hash}`,
    );
  }
  if (
    f.midnight_block_number !== undefined &&
    before?.midnight_block_number !== f.midnight_block_number
  ) {
    lines.push(
      `    midnight_block_number: ${before?.midnight_block_number ?? '(null)'} → ${f.midnight_block_number}`,
    );
  }
  if (
    f.midnight_confirmed_at !== undefined &&
    before?.midnight_confirmed_at !== f.midnight_confirmed_at
  ) {
    lines.push(
      `    midnight_confirmed_at: ${before?.midnight_confirmed_at ?? '(null)'} → ${f.midnight_confirmed_at}`,
    );
  }
  if (before?.midnight_status !== 'confirmed') {
    lines.push(
      `    midnight_status:       ${before?.midnight_status ?? '(null)'} → confirmed`,
    );
  }
  if (before?.midnight_error != null) {
    lines.push(
      `    midnight_error:        (cleared) ← was: ${truncate(before.midnight_error)}`,
    );
  }
  return lines.length === 0
    ? '    (no changes — already aligned)'
    : lines.join('\n');
};

const applyOne = async (target: RealignTarget): Promise<void> => {
  const set: string[] = [
    `midnight_status = 'confirmed'`,
    `midnight_error = NULL`,
  ];
  const params: unknown[] = [];
  if (target.fields.batch_id !== undefined) {
    set.push('batch_id = ?');
    params.push(target.fields.batch_id);
  }
  if (target.fields.midnight_tx_hash !== undefined) {
    set.push('midnight_tx_hash = ?');
    params.push(target.fields.midnight_tx_hash);
  }
  if (target.fields.midnight_block_number !== undefined) {
    set.push('midnight_block_number = ?');
    params.push(target.fields.midnight_block_number);
  }
  if (target.fields.midnight_confirmed_at !== undefined) {
    set.push('midnight_confirmed_at = ?');
    params.push(target.fields.midnight_confirmed_at);
  }
  const sql = `UPDATE catch_report_images SET ${set.join(', ')} WHERE id = ? AND image_hash LIKE ?`;
  params.push(target.image_row_id, target.image_hash_prefix + '%');
  await d1Query(sql, params);
};

const verifyOnChain = async (
  providers: GyotakCatchProviders,
  contractAddress: string,
  target: RealignTarget,
): Promise<{ ok: boolean; info: string }> => {
  const hex = hexFromBytes(textToBytes32(target.batch_id_expected));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec = await api.getCatchLedgerState(providers, contractAddress as any, hex);
  if (!rec) return { ok: false, info: 'not found on-chain' };
  const onChainPhotoHashHex = hexFromBytes(rec.photoHash);
  if (!onChainPhotoHashHex.startsWith(target.image_hash_prefix)) {
    return {
      ok: false,
      info: `photoHash mismatch: on-chain=${onChainPhotoHashHex.slice(0, 16)}, expected prefix=${target.image_hash_prefix}`,
    };
  }
  return {
    ok: true,
    info: `photoHash on-chain matches prefix ${target.image_hash_prefix}`,
  };
};

const main = async (): Promise<number> => {
  const apply = process.argv.includes('--apply');
  console.log('========================================');
  console.log('realign-d1-with-chain  (one-shot)');
  console.log(`mode: ${apply ? 'APPLY (will write to D1)' : 'DRY-RUN (no writes)'}`);
  console.log('========================================\n');

  if (!process.env.CF_API_TOKEN) {
    console.error('ERROR: CF_API_TOKEN is not set. export CF_API_TOKEN=... first.');
    return 1;
  }

  // Phase A: Show Before + plan per target (both in dry-run and apply)
  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i];
    console.log(`[${i + 1}/${TARGETS.length}] row_id=${t.image_row_id}`);
    console.log(`  catch_report_id: ${t.catch_report_id}`);
    console.log(`  expected_batch:  ${t.batch_id_expected}`);
    console.log(`  source:          ${t.source_notes}`);
    const before = await fetchCurrentImageState(
      t.catch_report_id,
      t.image_row_id,
    );
    console.log('  BEFORE:');
    console.log(formatSnapshot(before));
    console.log('  PLAN (diff to be applied):');
    console.log(diffToPlan(before, t));
    console.log('');
  }

  if (!apply) {
    console.log('========================================');
    console.log('This was a dry-run. Pass --apply to actually write to D1.');
    console.log('========================================');
    return 0;
  }

  // Phase B: Apply each UPDATE
  console.log('Applying UPDATEs...\n');
  for (let i = 0; i < TARGETS.length; i++) {
    const t = TARGETS[i];
    console.log(`[${i + 1}/${TARGETS.length}] applying to row_id=${t.image_row_id}...`);
    await applyOne(t);
    const after = await fetchCurrentImageState(
      t.catch_report_id,
      t.image_row_id,
    );
    console.log('  AFTER:');
    console.log(formatSnapshot(after));
    console.log('');
  }

  // Phase C: On-chain verification via read-only getCatchLedgerState
  console.log('On-chain verification (read-only, no tx)...\n');
  const config = new PreviewConfig();
  const logger = await createLogger(config.logDir);
  api.setLogger(logger);
  const walletCtx = await api.buildWalletAndWaitForFunds(config, readSeed());
  try {
    const providers = await api.configureProviders(walletCtx, config);
    const contractAddress = readContractAddress();
    let allOk = true;
    for (const t of TARGETS) {
      const v = await verifyOnChain(providers, contractAddress, t);
      console.log(
        `  ${t.batch_id_expected}: ${v.ok ? 'OK' : 'MISMATCH'} — ${v.info}`,
      );
      if (!v.ok) allOk = false;
    }
    if (!allOk) {
      console.error(
        '\nWARNING: one or more rows failed on-chain verification. Investigate before trusting D1.',
      );
    }
  } finally {
    await walletCtx.wallet.stop();
  }

  console.log('\nrealign-d1-with-chain done.');
  return 0;
};

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(
      `fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
    );
    process.exit(1);
  });
