import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MainnetConfig, PreprodConfig, type Config } from '../src/config.js';
import { createLogger } from '../src/logger-utils.js';
import * as api from '../src/api.js';
import {
  readSeed,
  readContractAddress,
  submitCatchRecord,
  buildFishManifest,
  buildFishSpeciesSummary,
  bytes32ToAscii,
  textToBytes32,
  hexFromBytes,
  degreesToUint32,
} from '../src/cli.js';
import { registerGpsCoords, registerGpsNonce } from '../src/witnesses.js';
import type { GyotakCatchProviders } from '../src/common-types.js';
// SP-3-3-4: 回路が計算する gpsCommitment を submit 前に手元で再現し、D1 が顧客に見せている値と
// 一致することを確かめるために使う (食べた写真のみ)。
import {
  persistentCommit,
  CompactTypeVector,
  CompactTypeUnsignedInteger,
} from '@midnight-ntwrk/compact-runtime';

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
  // v2: parent catch_reports.fish_items JSON (per-report; repeats across sibling
  // image rows). Fed to buildFishManifest to produce the plaintext fishManifest.
  fish_items: string;
}

// Preview the manifest a row would record (non-empty slots), for DRY_RUN logging.
const manifestPreview = (fishItemsJson: string): string => {
  const filled = buildFishManifest(fishItemsJson)
    .map((s) => bytes32ToAscii(s))
    .filter((a) => a.length > 0);
  return filled.length
    ? `[${filled.map((x) => `"${x}"`).join(', ')}] (${filled.length}/10 slots)`
    : '<empty manifest>';
};

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

// ── GPS nonce persistence ──────────────────────────────────────────────────
// Ensures each batchId gets exactly one nonce, persisted in D1 before the
// on-chain submit. PRIMARY KEY on batch_id prevents overwrites structurally.

const getOrCreateNonce = async (batchId: string): Promise<Uint8Array> => {
  // 1. Generate a candidate nonce and attempt INSERT with ON CONFLICT DO NOTHING.
  //    If the row already exists (re-mirror or race), the INSERT silently does nothing.
  const candidate = randomBytes(32);
  const candidateHex = Buffer.from(candidate).toString('hex');
  await d1Query(
    'INSERT INTO catch_gps_nonces (batch_id, gps_nonce) VALUES (?, ?) ON CONFLICT(batch_id) DO NOTHING',
    [batchId, candidateHex],
  );
  // 2. Always read back from D1 — the authoritative value is what D1 has,
  //    not what we generated. This guarantees chain and D1 stay in sync
  //    even if a concurrent writer raced us.
  const rows = await d1Query<{ gps_nonce: string }>(
    'SELECT gps_nonce FROM catch_gps_nonces WHERE batch_id = ?',
    [batchId],
  );
  if (rows.length === 0) {
    throw new Error(
      `getOrCreateNonce: INSERT succeeded but SELECT returned empty for batch_id=${batchId}. ` +
      `This should never happen — aborting to prevent nonce-less submit.`,
    );
  }
  return Uint8Array.from(Buffer.from(rows[0].gps_nonce, 'hex'));
};

// ── GPS bounding box lookup ────────────────────────────────────────────────
// regions.json: [{ name, short_name, latMin, latMax, lonMin, lonMax }] (degrees, WGS84)
interface RegionBox {
  name: string;
  short_name: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

const loadRegions = (): RegionBox[] => {
  const p = resolve(import.meta.url.replace('file://', ''), '..', '..', 'regions.json');
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as RegionBox[];
  } catch {
    return [];
  }
};

const findBox = (regions: RegionBox[], lat: number, lng: number): RegionBox => {
  const match = regions.find(
    (r) => lat >= r.latMin && lat <= r.latMax && lng >= r.lonMin && lng <= r.lonMax,
  );
  if (!match) {
    throw new Error(
      `GPS (${lat}, ${lng}) does not fall within any region in regions.json. ` +
      `Add a bounding box for this area before mirroring.`,
    );
  }
  return match;
};

// fishSpecies: built from fish_items romaji names via buildFishSpeciesSummary
// (no longer uses r.title, which is Japanese and overflows Bytes<32>).
// regionLabel: uses box.short_name from regions.json (not D1's location_en,
// which is too long for Bytes<32>). Image-level GPS takes
// precedence over the parent report's GPS. Legacy rows with null batch_id
// cannot be submitted to the contract and are excluded.
// ONLY_BATCH: when set, restrict to a single batch_id (preprod testing).
// Prevents the mirror from accidentally picking up production pending rows.
const ONLY_BATCH = process.env.ONLY_BATCH?.trim() || '';

const fetchPending = async (): Promise<PendingRow[]> => {
  const batchFilter = ONLY_BATCH ? 'AND i.batch_id = ?' : '';
  const params: unknown[] = ONLY_BATCH ? [ONLY_BATCH, BATCH_LIMIT] : [BATCH_LIMIT];
  return d1Query<PendingRow>(
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
       COALESCE(r.title, '') AS fish_species,
       COALESCE(r.fish_items, '') AS fish_items
     FROM catch_report_images i
     LEFT JOIN catch_reports r ON r.id = i.catch_report_id
     WHERE i.midnight_status = 'pending'
       AND i.batch_id IS NOT NULL
       ${batchFilter}
     ORDER BY i.created_at ASC
     LIMIT ?`,
    params,
  );
};

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
  contractAddress: string,
): Promise<void> => {
  await d1Query(
    `UPDATE catch_report_images
     SET midnight_status = 'confirmed',
         midnight_tx_hash = ?,
         midnight_block_number = ?,
         midnight_confirmed_at = ?,
         midnight_contract_address = ?,
         midnight_error = NULL
     WHERE id = ?`,
    [txHash, blockNumber, Date.now(), contractAddress, id],
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

// ─── SP-3-3-4: 食べた写真 (share_photos) の刻印 ────────────────────────────
// catch と同じ contract / wallet / proof server に相乗りする。違いは 3 点:
//   1. bbox は漁場の郡ではなく、写真の region_label が指す県 (provinces.json)。
//      県が未登録なら submit せず skipped にする。県名を midnight_error に残すので
//      provinces.json に足せば次回の実行で拾われる。
//   2. nonce は撮影時に Worker が生成して share_photo_gps に入っている。ここでは絶対に
//      作らない。作ると D1 が顧客に見せている commitment とチェーン上の値がずれる。
//   3. 座標と nonce はログに出さない。写真は自宅や店で撮られる。

interface ProvinceBox {
  label: string;
  short_name: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

interface PendingPhoto {
  id: number | string;
  batch_id: string;
  sha256: string;
  region_label: string;
  captured_at: string | null;
  uploaded_at: string;
  gps_commitment: string | null;
  lat: number;
  lng: number;
  nonce: string;
}

// fishSpecies に入れる目印。batch_id の SP- 接頭辞と合わせて二重に区別する。
const SHARE_PHOTO_SPECIES = 'share-photo';

// MIRROR_PHOTOS=1|true|yes のときだけ写真を処理する。既定は off。
// cron の行にはまだ入れていないので、cron は catch だけを従来どおり処理する。
// 1 件ずつ手で刻印して DUST の消費量を確かめ、納得してから cron に足す。
const MIRROR_PHOTOS = /^(1|true|yes)$/i.test(process.env.MIRROR_PHOTOS ?? '');

// PHOTO_LIMIT: 1 回の実行で刻印する写真の上限。未指定なら catch と同じ 5 件。
// 最初の 1 件で DUST の消費量を測るときに PHOTO_LIMIT=1 で使う。
const PHOTO_LIMIT = (() => {
  const n = Number(process.env.PHOTO_LIMIT ?? '');
  return Number.isInteger(n) && n > 0 ? n : BATCH_LIMIT;
})();

const loadProvinces = (): ProvinceBox[] => {
  const p = resolve(import.meta.url.replace('file://', ''), '..', '..', 'provinces.json');
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as ProvinceBox[];
  } catch {
    return [];
  }
};

// region_label は Google 由来なので綴りが provinces.json とずれることがある
// ("Phang Nga" / "Phangnga"、"Buri Ram" / "Buriram")。英数字だけに落として比べる。
// 77 県はこの形にしても全て別々の文字列になる (provinces-source.md 参照)。
const normLabel = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const findProvince = (provinces: ProvinceBox[], label: string): ProvinceBox | undefined => {
  const want = normLabel(label);
  return want ? provinces.find((b) => normLabel(b.label) === want) : undefined;
};

// 回路の persistentCommit<Vector<2, Uint<32>>> と同じ型。
const GPS_RT = new CompactTypeVector(2, new CompactTypeUnsignedInteger(4294967295n, 4));

const expectedCommitmentHex = (lat: number, lng: number, nonce: Uint8Array): string =>
  hexFromBytes(persistentCommit(GPS_RT, [degreesToUint32(lat), degreesToUint32(lng)], nonce));

// 撮影時刻のタイ日付 (UTC+7)。Worker の batch_id 発番と同じ規則。
const thaiDate = (iso: string | null): string => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
};

// ONLY_BATCH: catch と同じく 1 件だけに絞れる。SP- の batch_id を渡せばその写真だけを刻印する。
const fetchPendingPhotos = async (): Promise<PendingPhoto[]> => {
  const batchFilter = ONLY_BATCH ? 'AND p.batch_id = ?' : '';
  const params: unknown[] = ONLY_BATCH ? [ONLY_BATCH, PHOTO_LIMIT] : [PHOTO_LIMIT];
  return d1Query<PendingPhoto>(
    `SELECT
       p.id AS id,
       p.batch_id AS batch_id,
       p.sha256 AS sha256,
       COALESCE(p.region_label, '') AS region_label,
       p.captured_at AS captured_at,
       p.uploaded_at AS uploaded_at,
       p.gps_commitment AS gps_commitment,
       g.lat AS lat,
       g.lng AS lng,
       g.nonce AS nonce
     FROM share_photos p
     JOIN share_photo_gps g ON g.sha256 = p.sha256
     WHERE p.midnight_status = 'pending'
       AND p.batch_id IS NOT NULL
       AND g.nonce IS NOT NULL
       ${batchFilter}
     ORDER BY p.id ASC
     LIMIT ?`,
    params,
  );
};

const markPhotoSubmitting = async (id: PendingPhoto['id']): Promise<void> => {
  await d1Query(
    `UPDATE share_photos
     SET midnight_status = 'submitting', midnight_submitted_at = ?
     WHERE id = ? AND midnight_status = 'pending'`,
    [new Date().toISOString(), id],
  );
};

const revertPhotoToPending = async (id: PendingPhoto['id']): Promise<void> => {
  await d1Query(
    `UPDATE share_photos
     SET midnight_status = 'pending', midnight_submitted_at = NULL
     WHERE id = ? AND midnight_status = 'submitting'`,
    [id],
  );
};

const markPhotoConfirmed = async (
  id: PendingPhoto['id'],
  txHash: string,
  blockNumber: number | null,
  contractAddress: string,
): Promise<void> => {
  await d1Query(
    `UPDATE share_photos
     SET midnight_status = 'confirmed',
         midnight_tx_hash = ?,
         midnight_block_number = ?,
         midnight_confirmed_at = ?,
         midnight_contract_address = ?,
         midnight_error = NULL
     WHERE id = ?`,
    [txHash, blockNumber, new Date().toISOString(), contractAddress, id],
  );
};

const markPhotoFailed = async (id: PendingPhoto['id'], error: string): Promise<void> => {
  await d1Query(
    `UPDATE share_photos SET midnight_status = 'failed', midnight_error = ? WHERE id = ?`,
    [error.slice(0, 1000), id],
  );
};

// skipped: このコードでは刻印できないが、写真そのものは正常な行。理由を残して次の実行では拾わない。
const markPhotoSkipped = async (id: PendingPhoto['id'], reason: string): Promise<void> => {
  await d1Query(
    `UPDATE share_photos SET midnight_status = 'skipped', midnight_error = ? WHERE id = ?`,
    [reason.slice(0, 1000), id],
  );
};

const markPhotoAlreadyOnChain = async (id: PendingPhoto['id']): Promise<void> => {
  await d1Query(
    `UPDATE share_photos SET midnight_status = 'confirmed', midnight_error = NULL WHERE id = ?`,
    [id],
  );
};

interface PhotoTally {
  success: number;
  recovered: number;
  failed: number;
  skipped: number;
  wouldSubmit: number;
  aborted: boolean;
}

const processPhotos = async (
  providers: GyotakCatchProviders,
  contract: Parameters<typeof submitCatchRecord>[0],
  contractAddress: string,
  provinces: ProvinceBox[],
  photos: PendingPhoto[],
): Promise<PhotoTally> => {
  const tally: PhotoTally = { success: 0, recovered: 0, failed: 0, skipped: 0, wouldSubmit: 0, aborted: false };

  for (const photo of photos) {
    const shortSha = photo.sha256.slice(0, 12);
    const label = (photo.region_label ?? '').trim();

    const box = findProvince(provinces, label);
    if (!box) {
      if (!DRY_RUN) await markPhotoSkipped(photo.id, `province not in provinces.json: ${label || '(no region_label)'}`);
      tally.skipped += 1;
      logErr(`photo id=${photo.id} batch=${photo.batch_id} → skipped: province not in provinces.json: ${label || '(no region_label)'}`);
      continue;
    }

    // ラベルの県と座標が食い違う場合 (国境付近で 2 つの出典がずれた場合) は submit しない。
    // 回路は bbox しか検証しないので、通してしまうと proof が支えないラベルがチェーンに載る。
    if (!(photo.lat >= box.latMin && photo.lat <= box.latMax && photo.lng >= box.lonMin && photo.lng <= box.lonMax)) {
      if (!DRY_RUN) await markPhotoSkipped(photo.id, `coordinates fall outside the bounding box of "${box.label}"`);
      tally.skipped += 1;
      logErr(`photo id=${photo.id} batch=${photo.batch_id} → skipped: coordinates outside the box of "${box.label}"`);
      continue;
    }

    let nonceBytes: Uint8Array;
    const raw = Buffer.from(photo.nonce, 'hex');
    if (raw.length !== 32) {
      if (!DRY_RUN) await markPhotoFailed(photo.id, `nonce is not 32 bytes (decoded ${raw.length})`);
      tally.failed += 1;
      logErr(`photo id=${photo.id} batch=${photo.batch_id} → failed: nonce is not 32 bytes (decoded ${raw.length})`);
      continue;
    }
    nonceBytes = new Uint8Array(raw);

    // D1 が顧客に見せている commitment と、回路がこれから計算する値が一致することを確かめる。
    // ずれたまま刻印すると「見せている値」と「鎖上の値」が別物になる。
    if (!photo.gps_commitment) {
      if (!DRY_RUN) await markPhotoSkipped(photo.id, 'gps_commitment is missing in D1');
      tally.skipped += 1;
      logErr(`photo id=${photo.id} batch=${photo.batch_id} → skipped: gps_commitment is missing in D1`);
      continue;
    }
    const expected = expectedCommitmentHex(photo.lat, photo.lng, nonceBytes);
    if (photo.gps_commitment.toLowerCase() !== expected) {
      if (!DRY_RUN) await markPhotoSkipped(photo.id, 'gps_commitment in D1 does not match what the circuit would compute');
      tally.skipped += 1;
      logErr(`photo id=${photo.id} batch=${photo.batch_id} → skipped: gps_commitment mismatch (D1 vs circuit)`);
      continue;
    }

    try {
      if (await isAlreadyOnChain(providers, contractAddress, photo.batch_id)) {
        if (!DRY_RUN) await markPhotoAlreadyOnChain(photo.id);
        tally.recovered += 1;
        log(`photo id=${photo.id} batch=${photo.batch_id} → already on-chain (pre-check)${DRY_RUN ? ' [DRY_RUN: would mark confirmed]' : ', marking confirmed (recovery)'}`);
        continue;
      }
    } catch (preCheckErr) {
      logErr(
        `photo id=${photo.id} batch=${photo.batch_id} → pre-check failed, falling through to submit: ${
          preCheckErr instanceof Error ? preCheckErr.message : String(preCheckErr)
        }`,
      );
    }

    const catchDate = thaiDate(photo.captured_at) || thaiDate(photo.uploaded_at);

    if (DRY_RUN) {
      tally.wouldSubmit += 1;
      log(
        `[DRY_RUN] photo id=${photo.id} batch=${photo.batch_id} → WOULD submit recordCatch ` +
          `(province=${box.short_name} date=${catchDate} species=${SHARE_PHOTO_SPECIES} photoHash=${shortSha}…) — no tx sent, D1 unchanged`,
      );
      continue;
    }

    registerGpsNonce(photo.batch_id, nonceBytes);
    await markPhotoSubmitting(photo.id);
    try {
      const result = await submitCatchRecord(contract, {
        batchId: photo.batch_id,
        region: box.short_name,
        catchDate,
        fishSpecies: SHARE_PHOTO_SPECIES,
        photoHashHex: photo.sha256,
        gpsLat: photo.lat,
        gpsLng: photo.lng,
        latMin: box.latMin,
        latMax: box.latMax,
        lonMin: box.lonMin,
        lonMax: box.lonMax,
      });
      const blockNumber =
        typeof result.blockHeight === 'bigint' ? Number(result.blockHeight) : result.blockHeight;
      await markPhotoConfirmed(photo.id, result.txId, blockNumber, contractAddress);
      tally.success += 1;
      log(`photo id=${photo.id} batch=${photo.batch_id} → confirmed tx=${result.txId} block=${blockNumber}`);
    } catch (e) {
      const category = categorizeError(e);
      const msg = e instanceof Error ? e.message : String(e);
      if (category === 'already_on_chain') {
        await markPhotoAlreadyOnChain(photo.id);
        tally.recovered += 1;
        log(`photo id=${photo.id} batch=${photo.batch_id} → already on-chain (post-submit detect), marking confirmed (recovery): ${msg}`);
        continue;
      }
      if (category === 'proof_server_down' || category === 'insufficient_funds') {
        await revertPhotoToPending(photo.id);
        tally.aborted = true;
        logErr(`photo id=${photo.id} batch=${photo.batch_id} → ${category}; reverted to pending. Aborting: ${msg}`);
        break;
      }
      await markPhotoFailed(photo.id, msg);
      tally.failed += 1;
      logErr(`photo id=${photo.id} batch=${photo.batch_id} → failed: ${msg}`);
    }
  }

  return tally;
};

const main = async (): Promise<number> => {
  // Config selection: NETWORK=mainnet → MainnetConfig.
  // Default (unset / anything else) → PreprodConfig (safe default for v3 development).
  const network = (process.env.NETWORK ?? '').toLowerCase();
  const config: Config = network === 'mainnet' ? new MainnetConfig() : new PreprodConfig();
  const networkLabel = network === 'mainnet' ? 'mainnet' : 'preprod';
  const logger = await createLogger(config.logDir);

  if (network === 'mainnet') {
    const addr = readContractAddress();
    log(`*** MAINNET MODE *** contract=${addr}`);
  }
  log(`mirror-pending starting (limit=${BATCH_LIMIT}, network=${networkLabel}${ONLY_BATCH ? `, ONLY_BATCH=${ONLY_BATCH}` : ''}${DRY_RUN ? ', DRY_RUN' : ''}${MIRROR_PHOTOS ? `, MIRROR_PHOTOS (limit=${PHOTO_LIMIT})` : ''})`);

  try {
    await probeProofServer(config.proofServer);
  } catch (e) {
    logErr(`proof server probe failed: ${(e as Error).message} — skipping run`);
    return 0;
  }

  let rows: PendingRow[];
  let photos: PendingPhoto[];
  try {
    rows = await fetchPending();
    photos = MIRROR_PHOTOS ? await fetchPendingPhotos() : [];
  } catch (e) {
    logErr(`D1 fetch failed: ${(e as Error).message}`);
    return 1;
  }

  if (rows.length === 0 && photos.length === 0) {
    log('no pending rows; nothing to do');
    console.log('success=0 recovered=0 failed=0 photos=0');
    return 0;
  }

  log(`fetched ${rows.length} pending catch row(s), ${photos.length} pending photo(s)`);

  // Load region bounding boxes for GPS range proof
  const regions = loadRegions();
  if (rows.length > 0 && regions.length === 0) {
    logErr('regions.json is empty — no bounding boxes defined. Cannot mirror.');
    return 1;
  }
  log(`loaded ${regions.length} region(s) from regions.json`);

  // SP-3-3-4: 写真は郡ではなく県の bbox を使う。未登録の県の写真は submit されず skipped になる。
  const provinces = photos.length > 0 ? loadProvinces() : [];
  if (photos.length > 0) {
    log(`loaded ${provinces.length} province(s) from provinces.json`);
  }

  api.setLogger(logger);
  const walletCtx = await api.buildWalletAndWaitForFunds(config, readSeed());

  let success = 0;
  let recovered = 0;
  let failed = 0;
  let wouldSubmit = 0;
  // SP-3-3-4: proof server / 残高で catch の途中打ち切りが起きたら、写真も試さない。
  let catchAborted = false;
  let photoTally: PhotoTally = { success: 0, recovered: 0, failed: 0, skipped: 0, wouldSubmit: 0, aborted: false };
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

      // v3: resolve bounding box from GPS + regions.json
      let box: RegionBox;
      try {
        box = findBox(regions, row.gps_lat, row.gps_lng);
      } catch (e) {
        failed += 1;
        logErr(`row id=${row.id} batch=${row.batch_id} → ${(e as Error).message}`);
        continue;
      }

      // v3: persist nonce BEFORE submit (nonce loss = commitment unrecoverable)
      let nonce: Uint8Array;
      try {
        nonce = await getOrCreateNonce(row.batch_id);
      } catch (e) {
        failed += 1;
        logErr(`row id=${row.id} batch=${row.batch_id} → nonce persistence failed: ${(e as Error).message}`);
        continue;
      }
      registerGpsNonce(row.batch_id, nonce);

      if (DRY_RUN) {
        wouldSubmit += 1;
        log(
          `[DRY_RUN] row id=${row.id} batch=${row.batch_id} → WOULD submit recordCatch ` +
            `(region=${row.region ?? ''} box=${box.name} date=${row.catch_date ?? ''} species=${row.fish_species ?? ''} ` +
            `photoHash=${row.image_hash} gps=${row.gps_lat},${row.gps_lng}` +
            ` manifest=${manifestPreview(row.fish_items ?? '')}) — no tx sent, D1 unchanged`,
        );
        continue;
      }

      await markSubmitting(row.id);
      try {
        const result = await submitCatchRecord(contract, {
          batchId: row.batch_id,
          region: box.short_name,
          catchDate: row.catch_date ?? '',
          fishSpecies: buildFishSpeciesSummary(row.fish_items ?? ''),
          fishManifest: buildFishManifest(row.fish_items ?? ''),
          photoHashHex: row.image_hash,
          gpsLat: row.gps_lat,
          gpsLng: row.gps_lng,
          latMin: box.latMin,
          latMax: box.latMax,
          lonMin: box.lonMin,
          lonMax: box.lonMax,
        });
        const blockNumber =
          typeof result.blockHeight === 'bigint' ? Number(result.blockHeight) : result.blockHeight;
        await markConfirmed(row.id, result.txId, blockNumber, contractAddress);
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
          catchAborted = true;
          logErr(
            `row id=${row.id} batch=${row.batch_id} → proof server down mid-run; reverted to pending. Aborting: ${msg}`,
          );
          break;
        }
        if (category === 'insufficient_funds') {
          await revertToPending(row.id);
          catchAborted = true;
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

    // SP-3-3-4: catch を処理し終えてから、同じウォレット・同じ contract で食べた写真を刻印する。
    if (photos.length > 0 && !catchAborted) {
      photoTally = await processPhotos(providers, contract, contractAddress, provinces, photos);
    } else if (photos.length > 0) {
      logErr(`skipping ${photos.length} pending photo(s): the catch pass aborted this run`);
    }
  } finally {
    await walletCtx.wallet.stop();
  }

  const photoSummary =
    `photos: success=${photoTally.success} recovered=${photoTally.recovered} failed=${photoTally.failed} skipped=${photoTally.skipped}`;

  if (DRY_RUN) {
    log(
      `done [DRY_RUN]: would_submit=${wouldSubmit} already_on_chain=${recovered} pending_rows=${rows.length} ` +
        `photo_would_submit=${photoTally.wouldSubmit} photo_skipped=${photoTally.skipped} pending_photos=${photos.length} (no tx sent, D1 unchanged)`,
    );
    console.log(
      `[DRY_RUN] would_submit=${wouldSubmit} already_on_chain=${recovered} pending_rows=${rows.length} ` +
        `photo_would_submit=${photoTally.wouldSubmit} photo_skipped=${photoTally.skipped} pending_photos=${photos.length}`,
    );
    return 0;
  }

  log(`done: success=${success} recovered=${recovered} failed=${failed} | ${photoSummary}`);
  console.log(`success=${success} recovered=${recovered} failed=${failed} ${photoSummary}`);
  return 0;
};

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    logErr(`fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    process.exit(1);
  });
