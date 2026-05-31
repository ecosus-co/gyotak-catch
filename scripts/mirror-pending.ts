import { MainnetConfig } from '../src/config.js';
import { createLogger } from '../src/logger-utils.js';
import * as api from '../src/api.js';
import {
  readSeed,
  readContractAddress,
  submitCatchRecord,
  textToBytes32,
  hexFromBytes,
} from '../src/cli.js';
import type { GyotakCatchProviders } from '../src/common-types.js';

const CF_ACCOUNT_ID = '3f77cb87bd4075a1a60b7ee7aff41947';
const CF_DATABASE_ID = '03134e75-87c3-49a1-a9a0-93474911ac52';
const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_DATABASE_ID}/query`;
const BATCH_LIMIT = 5;
// DRY_RUN=1|true|yes: read-only rehearsal. Fetches pending rows, builds the wallet and
// runs the on-chain pre-check, but submits NO transactions and makes NO D1 writes.
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? '');

interface PendingRow {
  id: number | string;
  batch_id: string;
  image_hash: string;
  gps_lat: number;
  gps_lng: number;
  gps_alt: number | null;
  photo_taken_at: number | null;
  region: string;
  catch_date: string;
  fish_species: string;
}

const stamp = (): string => new Date().toISOString();

// Logs to stdout/stderr only; the cron's `>>` redirect owns the file
// destination. (Previously this also appended to a hardcoded LOG_FILE, which
// duplicated every line once the cron redirect pointed at the same path.)
const log = (line: string): void => {
  process.stdout.write(`[${stamp()}] ${line}\n`);
};

const logErr = (line: string): void => {
  process.stderr.write(`[${stamp()}] ${line}\n`);
};

const d1Query = async <T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> => {
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
  if (!res.ok) {
    throw new Error(`D1 HTTP ${res.status}: ${bodyText}`);
  }
  const body = JSON.parse(bodyText) as {
    success: boolean;
    errors?: Array<{ message: string }>;
    result?: Array<{ results: T[] }>;
  };
  if (!body.success) {
    const msg = body.errors?.map((e) => e.message).join('; ') ?? 'unknown D1 error';
    throw new Error(`D1 query failed: ${msg}`);
  }
  return body.result?.[0]?.results ?? [];
};

// catch_reports has no fish_species column; the Japanese species name lives in
// r.title, so we use that (textToBytes32 truncates to 32 bytes). region falls
// back to r.location (Thai) when location_en is null. Image-level GPS takes
// precedence over the parent report's GPS. Legacy rows with null batch_id
// cannot be submitted to the contract and are excluded.
const fetchPending = async (): Promise<PendingRow[]> =>
  d1Query<PendingRow>(
    `SELECT
       i.id AS id,
       i.batch_id AS batch_id,
       i.image_hash AS image_hash,
       COALESCE(i.gps_lat, r.gps_lat) AS gps_lat,
       COALESCE(i.gps_lng, r.gps_lon) AS gps_lng,
       COALESCE(i.gps_alt, r.gps_alt) AS gps_alt,
       COALESCE(i.photo_taken_at, r.photo_taken_at) AS photo_taken_at,
       COALESCE(r.location_en, r.location, '') AS region,
       COALESCE(r.date, '') AS catch_date,
       COALESCE(r.title, '') AS fish_species
     FROM catch_report_images i
     LEFT JOIN catch_reports r ON r.id = i.catch_report_id
     WHERE i.midnight_status = 'pending'
       AND i.batch_id IS NOT NULL
     ORDER BY i.created_at ASC
     LIMIT ?`,
    [BATCH_LIMIT],
  );

const markSubmitting = async (id: PendingRow['id']): Promise<void> => {
  await d1Query(
    `UPDATE catch_report_images
     SET midnight_status = 'submitting', midnight_submitted_at = ?
     WHERE id = ? AND midnight_status = 'pending'`,
    [Date.now(), id],
  );
};

const revertToPending = async (id: PendingRow['id']): Promise<void> => {
  await d1Query(
    `UPDATE catch_report_images
     SET midnight_status = 'pending', midnight_submitted_at = NULL
     WHERE id = ? AND midnight_status = 'submitting'`,
    [id],
  );
};

const markConfirmed = async (
  id: PendingRow['id'],
  txHash: string,
  blockNumber: number | null,
): Promise<void> => {
  await d1Query(
    `UPDATE catch_report_images
     SET midnight_status = 'confirmed',
         midnight_tx_hash = ?,
         midnight_block_number = ?,
         midnight_confirmed_at = ?,
         midnight_error = NULL
     WHERE id = ?`,
    [txHash, blockNumber, Date.now(), id],
  );
};

const markFailed = async (id: PendingRow['id'], error: string): Promise<void> => {
  await d1Query(
    `UPDATE catch_report_images
     SET midnight_status = 'failed', midnight_error = ?
     WHERE id = ?`,
    [error.slice(0, 1000), id],
  );
};

// markAlreadyOnChain: contract 上に既に存在する batch を表す D1 状態に戻す。
// 既存の midnight_tx_hash / midnight_block_number / midnight_confirmed_at は
// 保持する (過去の markConfirmed が書いた値を残す)。status と error のみ触る。
const markAlreadyOnChain = async (id: PendingRow['id']): Promise<void> => {
  await d1Query(
    `UPDATE catch_report_images
     SET midnight_status = 'confirmed', midnight_error = NULL
     WHERE id = ?`,
    [id],
  );
};

// isAlreadyOnChain: getCatchLedgerState で contract の batches map を照会し
// 当該 batchId が既に存在するかを返す。読み取り専用 (proof/tx/手数料なし)。
const isAlreadyOnChain = async (
  providers: GyotakCatchProviders,
  contractAddress: string,
  batchId: string,
): Promise<boolean> => {
  const hex = hexFromBytes(textToBytes32(batchId));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const record = await api.getCatchLedgerState(providers, contractAddress as any, hex);
  return record !== null;
};

type ErrCategory = 'proof_server_down' | 'insufficient_funds' | 'already_on_chain' | 'row_failure';

const categorizeError = (e: unknown): ErrCategory => {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (
    msg.includes('econnrefused') ||
    msg.includes('proof server') ||
    msg.includes(':6300') ||
    msg.includes('fetch failed') && msg.includes('proof')
  ) {
    return 'proof_server_down';
  }
  if (
    msg.includes('insufficient') &&
    (msg.includes('dust') || msg.includes('fund') || msg.includes('balance') || msg.includes('night'))
  ) {
    return 'insufficient_funds';
  }
  if (msg.includes('catch already exists') || msg.includes('already exists')) {
    return 'already_on_chain';
  }
  return 'row_failure';
};

const probeProofServer = async (url: string): Promise<void> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    throw new Error(`Proof server unreachable at ${url}: ${(e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
};

const main = async (): Promise<number> => {
  const config = new MainnetConfig();
  const logger = await createLogger(config.logDir);

  log(`mirror-pending starting (limit=${BATCH_LIMIT}${DRY_RUN ? ', DRY_RUN' : ''})`);

  try {
    await probeProofServer(config.proofServer);
  } catch (e) {
    logErr(`proof server probe failed: ${(e as Error).message} — skipping run`);
    return 0;
  }

  let rows: PendingRow[];
  try {
    rows = await fetchPending();
  } catch (e) {
    logErr(`D1 fetch failed: ${(e as Error).message}`);
    return 1;
  }

  if (rows.length === 0) {
    log('no pending rows; nothing to do');
    console.log('success=0 recovered=0 failed=0');
    return 0;
  }

  log(`fetched ${rows.length} pending row(s)`);

  api.setLogger(logger);
  const walletCtx = await api.buildWalletAndWaitForFunds(config, readSeed());

  let success = 0;
  let recovered = 0;
  let failed = 0;
  let wouldSubmit = 0;
  const contractAddress = readContractAddress();
  try {
    const providers = await api.configureProviders(walletCtx, config);
    const contract = await api.joinContract(providers, contractAddress);

    for (const row of rows) {
      // Pre-check: contract の batches map に同じ batchId が既に存在するか。
      // 存在する場合は proof 生成 / tx 送信をスキップし、D1 のみ confirmed に戻す。
      // (別経路で submit 済みなのに D1 status が 'pending' に戻っていた状態の自己治癒)
      try {
        if (await isAlreadyOnChain(providers, contractAddress, row.batch_id)) {
          if (!DRY_RUN) await markAlreadyOnChain(row.id);
          recovered += 1;
          log(
            `row id=${row.id} batch=${row.batch_id} → already on-chain (pre-check)${
              DRY_RUN ? ' [DRY_RUN: would mark confirmed]' : ', marking confirmed (recovery)'
            }`,
          );
          continue;
        }
      } catch (preCheckErr) {
        // pre-check 失敗時は通常 submit にフォールバック (indexer が一時的に不可なら submit が
        // proof_server_down を検知する。サイレントに握り潰さずログは残す)
        logErr(
          `row id=${row.id} batch=${row.batch_id} → pre-check failed, falling through to submit: ${
            preCheckErr instanceof Error ? preCheckErr.message : String(preCheckErr)
          }`,
        );
      }

      if (DRY_RUN) {
        wouldSubmit += 1;
        log(
          `[DRY_RUN] row id=${row.id} batch=${row.batch_id} → WOULD submit recordCatch ` +
            `(region=${row.region ?? ''} date=${row.catch_date ?? ''} species=${row.fish_species ?? ''} ` +
            `photoHash=${row.image_hash} gps=${row.gps_lat},${row.gps_lng}) — no tx sent, D1 unchanged`,
        );
        continue;
      }

      await markSubmitting(row.id);
      try {
        const result = await submitCatchRecord(contract, {
          batchId: row.batch_id,
          region: row.region ?? '',
          catchDate: row.catch_date ?? '',
          fishSpecies: row.fish_species ?? '',
          photoHashHex: row.image_hash,
          gpsLat: row.gps_lat,
          gpsLng: row.gps_lng,
        });
        const blockNumber =
          typeof result.blockHeight === 'bigint' ? Number(result.blockHeight) : result.blockHeight;
        await markConfirmed(row.id, result.txId, blockNumber);
        success += 1;
        log(
          `row id=${row.id} batch=${row.batch_id} → confirmed tx=${result.txId} block=${blockNumber}`,
        );
      } catch (e) {
        const category = categorizeError(e);
        const msg = e instanceof Error ? e.message : String(e);
        // already_on_chain: pre-check とのレースで submit してしまった場合、または
        // pre-check で別理由のエラーが出てフォールスルーした先で contract が
        // "catch already exists" を返した場合の事後救済。
        // (proof_server_down / insufficient_funds より先に判定することで、
        //  誤って revertToPending されて再試行ループに入るのを防ぐ)
        if (category === 'already_on_chain') {
          await markAlreadyOnChain(row.id);
          recovered += 1;
          log(
            `row id=${row.id} batch=${row.batch_id} → already on-chain (post-submit detect), marking confirmed (recovery): ${msg}`,
          );
          continue;
        }
        if (category === 'proof_server_down') {
          await revertToPending(row.id);
          logErr(
            `row id=${row.id} batch=${row.batch_id} → proof server down mid-run; reverted to pending. Aborting: ${msg}`,
          );
          break;
        }
        if (category === 'insufficient_funds') {
          await revertToPending(row.id);
          logErr(
            `row id=${row.id} batch=${row.batch_id} → insufficient funds; reverted to pending. Aborting: ${msg}`,
          );
          break;
        }
        await markFailed(row.id, msg);
        failed += 1;
        logErr(`row id=${row.id} batch=${row.batch_id} → failed: ${msg}`);
      }
    }
  } finally {
    await walletCtx.wallet.stop();
  }

  if (DRY_RUN) {
    log(
      `done [DRY_RUN]: would_submit=${wouldSubmit} already_on_chain=${recovered} pending_rows=${rows.length} (no tx sent, D1 unchanged)`,
    );
    console.log(
      `[DRY_RUN] would_submit=${wouldSubmit} already_on_chain=${recovered} pending_rows=${rows.length}`,
    );
    return 0;
  }

  log(`done: success=${success} recovered=${recovered} failed=${failed}`);
  console.log(`success=${success} recovered=${recovered} failed=${failed}`);
  return 0;
};

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    logErr(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    process.exit(1);
  });
