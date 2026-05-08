import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export type GyotakCatchPrivateState = {
  readonly salt: Uint8Array;
};

export const initialPrivateState: GyotakCatchPrivateState = {
  salt: new Uint8Array(32),
};

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const batchKey = (human: string): string => {
  const enc = new TextEncoder().encode(human);
  const buf = new Uint8Array(32);
  buf.set(enc.slice(0, 32));
  return toHex(buf);
};

/**
 * Off-chain GPS DB. Coords are (lat_e7, lng_e7) as Uint<32> pair — i.e. degrees * 1e7.
 * Entries can also be injected at runtime via the GPS_JSON env var, path to a JSON file
 * of the form: { "CR-20260421-TEST": [1234567890, 987654321] }
 */
const STATIC_GPS: ReadonlyArray<[string, readonly [bigint, bigint]]> = [];

const loadRuntimeGps = (): Map<string, readonly [bigint, bigint]> => {
  const out = new Map<string, readonly [bigint, bigint]>();
  for (const [k, v] of STATIC_GPS) {
    out.set(batchKey(k), v);
  }
  const p = process.env.GPS_JSON;
  if (p && existsSync(resolve(p))) {
    const raw = JSON.parse(readFileSync(resolve(p), 'utf8')) as Record<string, [number | string, number | string]>;
    for (const [humanId, pair] of Object.entries(raw)) {
      out.set(batchKey(humanId), [BigInt(pair[0]), BigInt(pair[1])] as const);
    }
  }
  return out;
};

const GPS_DB: Map<string, readonly [bigint, bigint]> = loadRuntimeGps();

// Allows callers (e.g. scripts/mirror-pending.ts) to register GPS coords at
// runtime without writing a JSON file, after witnesses.ts has been imported.
export const registerGpsCoords = (humanBatchId: string, latE7: bigint, lngE7: bigint): void => {
  GPS_DB.set(batchKey(humanBatchId), [latE7, lngE7] as const);
};

// ── Admin secret key for owner-gated circuits ────────────────────────────
//
// Source priority:
//   1. GYOTAK_MIDNIGHT_ADMIN_SK env var   (64 hex chars, no 0x prefix)
//   2. GYOTAK_MIDNIGHT_ADMIN_SK_FILE env var (path to a 64 hex char file)
//   3. ~/midnight/.gyotak-secrets/admin-sk.txt (default file location)
//
// No fallback to a baked-in or zero key. Missing / malformed key throws — by
// design — so a misconfigured cron run aborts before submitting an invalid
// proof, instead of silently authenticating with the wrong identity.

const DEFAULT_ADMIN_SK_FILE = resolve(homedir(), 'midnight', '.gyotak-secrets', 'admin-sk.txt');

const isWindows = process.platform === 'win32';

const assertNotWorldReadable = (path: string): void => {
  if (isWindows) return; // POSIX mode bits are not meaningful on Windows
  const stats = statSync(path);
  const mode = stats.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `gyotak-catch: ${path} permissions are too open (mode ${mode.toString(8)}); ` +
      `run \`chmod 600 ${path}\` and retry. Refusing to read a world/group-readable secret.`,
    );
  }
};

const parseHex32 = (hex: string, source: string): Uint8Array => {
  const clean = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(
      `gyotak-catch: admin secret key from ${source} must be exactly 64 hex characters; ` +
      `got ${clean.length} chars.`,
    );
  }
  return Uint8Array.from(clean.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
};

export const loadAdminSecretKey = (): Uint8Array => {
  const fromEnv = process.env.GYOTAK_MIDNIGHT_ADMIN_SK?.trim();
  if (fromEnv) {
    return parseHex32(fromEnv, 'env GYOTAK_MIDNIGHT_ADMIN_SK');
  }
  const filePath = process.env.GYOTAK_MIDNIGHT_ADMIN_SK_FILE?.trim() || DEFAULT_ADMIN_SK_FILE;
  if (!existsSync(filePath)) {
    throw new Error(
      `gyotak-catch: admin secret key not found. ` +
      `Set GYOTAK_MIDNIGHT_ADMIN_SK env var (64-char hex) ` +
      `or place the key at ${filePath} (chmod 600). ` +
      `No default key fallback exists — this is intentional.`,
    );
  }
  assertNotWorldReadable(filePath);
  const contents = readFileSync(filePath, 'utf8');
  return parseHex32(contents, `file ${filePath}`);
};

export const witnesses = {
  getGpsCoords(
    context: WitnessContext<unknown, GyotakCatchPrivateState>,
    batchId: Uint8Array,
  ): [GyotakCatchPrivateState, bigint[]] {
    const coords = GPS_DB.get(toHex(batchId)) ?? ([0n, 0n] as const);
    return [context.privateState, [coords[0], coords[1]]];
  },
  localSecretKey(
    context: WitnessContext<unknown, GyotakCatchPrivateState>,
  ): [GyotakCatchPrivateState, Uint8Array] {
    return [context.privateState, loadAdminSecretKey()];
  },
};
