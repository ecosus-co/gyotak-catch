# Mainnet Contract Deploy Failing with Substrate 1016

## Summary

GYOTAK catch-record contract deploy to **Midnight Mainnet** consistently
fails with `Substrate 1016: Immediately Dropped: The transaction couldn't
enter the pool because of the limit` despite all client-side checks
passing.

## Environment

| Item | Value |
|---|---|
| Wallet (submitter) | `mn_addr18ehfpzy7hyyj4gm6kt7zkwkejc3sg629yr23tsvjs8kjaf754yvqetqsrz` |
| DUST address | `mn_dust1wd6rgfyh77awlww7rs2cufcun5uwpjvfcd2jhs3dqx2k42msxrlhz5n3hje` |
| DUST balance | 350,232,351,165,986,264,759 specks (≈ 350,232 DUST), 1 UTXO |
| NIGHT (mNIGHT) balance | 0 (cross-wallet model: cNIGHT held in separate Lace wallet B) |
| Mainnet node version | `0.22.1-9ce45781` (`system_version` over JSON-RPC) |
| RPC endpoint | `https://rpc.mainnet.midnight.network` (public, no alternative known) |
| Indexer | `https://indexer.mainnet.midnight.network/api/v4/graphql` |
| Proof server | local `http://127.0.0.1:6300` (running fine) |

### SDK / package versions (from `package.json`)

```json
"@midnight-ntwrk/compact-runtime": "^0.15.0",
"@midnight-ntwrk/ledger-v8": "^8.0.3",
"@midnight-ntwrk/midnight-js": "^4.0.4",
"@midnight-ntwrk/midnight-js-contracts": "^4.0.4",
"@midnight-ntwrk/wallet-sdk-abstractions": "^2.1.0",
"@midnight-ntwrk/wallet-sdk-dust-wallet": "^3.0.0",
"@midnight-ntwrk/wallet-sdk-facade": "^3.0.0",
"@midnight-ntwrk/wallet-sdk-shielded": "^3.0.0",
"@midnight-ntwrk/wallet-sdk-unshielded-wallet": "^3.0.0"
```

### DUST registration / generation

cNIGHT held in Cardano Lace wallet B; DUST address registered on
Cardano via the official cnight-to-dust registration tx. Verified
working: DUST balance grows over time at the expected generation rate
(observed +7,711 DUST in ~3h via two independent reads of the Mainnet
indexer using `scripts/check-mainnet-balance.ts`).

## Reproduction (deterministic — 100% failure rate)

Six deploy attempts on 2026-04-29 (BKK timezone) and one on
2026-04-30. All attempts fail at the same place: client-side stages
(sync, DUST detection, providers, ZK proof generation) succeed, then
node submission is rejected with `1016`.

| # | Time (BKK) | Variant | Result |
|---|---|---|---|
| 1 | 13:00 | Original `buildWalletAndWaitForFunds` (legacy waitForFunds checking unshielded NIGHT balance) | Hung waiting for NIGHT > 0 (which is permanently 0 in cross-wallet model) |
| 2 | 14:36 | After fixing `waitForFunds` to check DUST balance | Hung at "Waiting for incoming tokens" — DUST never appeared in `wallet.state()` emissions |
| 3 | 15:43 | After fixing the gate at `buildWalletAndWaitForFunds` L446 to use `dust.availableCoins.length` | Same hang, `dust.coins` reported 0 indefinitely |
| 4 | 18:35 | Added diagnostic `Rx.tap` showing every emission; removed `withStatus` spinner wrapper | `isSynced=true` flipped at emission #12093 (28.3 min) but `state.dust.availableCoins.length` stayed `0` for the next 10+ minutes of synced steady-state. Killed at 38.5 min. |
| **5** | **21:39** | **Option F — bypassed `api.buildWalletAndWaitForFunds` entirely; replaced `src/mainnet.ts` with the wallet-build path from `scripts/check-mainnet-balance.ts` (which DOES see DUST reliably)** | **Wallet sync ✅ (37 min, DUST detected = 340k / 1 coin), providers ✅, ZK proof ✅. Node submit ❌ → `1016 Immediately Dropped`** |
| **6** | **2026-04-30 01:48** | Same as #5 but `additionalFeeOverhead` raised 100×: `300_000_000_000_000n` → `30_000_000_000_000_000n` (0.3 → 30 DUST) | Sync ✅ (29.5 min, DUST 350k), providers ✅, ZK proof ✅. **Identical `1016` rejection** |
| **7** | **2026-04-30 02:27** | Same as #6 + Compact contract recompiled (artifacts byte-identical, deterministic build confirmed) | Sync ✅ (29 min, DUST 351k), providers ✅, ZK proof ✅. **Identical `1016` rejection** |

## Hypotheses tested and eliminated

### 1. ❌ Pool overflow / mempool full

Queried `author_pendingExtrinsics` on
`https://rpc.mainnet.midnight.network` ~3.5 hours after attempt 5
failure. Result: `[]` (empty pool). Pool was not full.

```bash
$ curl -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"author_pendingExtrinsics","params":[]}' \
    https://rpc.mainnet.midnight.network
{"jsonrpc":"2.0","id":1,"result":[]}
```

### 2. ❌ Fee priority too low

`additionalFeeOverhead` raised 100× (0.3 DUST → 30 DUST) for attempt #6.
`midnight-js` testkit default in
`testkit-js/testkit-js/src/wallet/wallet-factory.ts` is
`500_000_000_000_000_000_000n` (500,000 DUST), so even our 100× value
is 16,667× smaller than the testkit default. But:
- Wallet only holds 350k DUST so we cannot match the testkit default
- 100× bump produced **identical** `1016` rejection (same error message,
  same stack)
- If priority were the bottleneck, 100× should have shifted behaviour
  at least slightly

### 3. ❌ Insufficient balance

DUST balance is 350,232,351,165,986,264,759 specks (≈ 350,232 DUST) in
1 UTXO. Default fee for a Compact contract deploy is on the order of
single-digit DUST. Balance is ~5 orders of magnitude above need.

### 4. ❌ Wallet seed / signature

The same wallet seed reads on-chain state correctly (the wallet's DUST
UTXO is observable via `state.dust.availableCoins` in
`scripts/check-mainnet-balance.ts`). HD derivation matches Midnight
Lace conventions (Roles.Zswap / Dust / NightExternal).

### 5. ❌ ZK proof generation

Proof server (local, port 6300) responds successfully; `api.deploy()`
proceeds past proof generation and into the submit phase. The 1016
fires ~6 seconds after `Deploying gyotak-catch contract...` log line,
consistent with proof gen having succeeded.

### 6. ❌ Pending TX from earlier attempts holding the slot

Pool was empty 3.5 h after attempt 5; mortality of any earlier TX
(`256` blocks @ 6 s = 25 min) had long expired before attempts 5 and 6.

## Open questions

1. **Per-account contract-deploy rate limit?** Is there a Mainnet rule
   limiting how often (or how soon after registration) a fresh wallet
   can deploy a Compact contract?
2. **Public RPC load balancer routing?** Could
   `rpc.mainnet.midnight.network` route `submitAndWatchExtrinsic` to a
   different node than the one that answered our
   `author_pendingExtrinsics` query, so that "pool empty" was observed
   on one node while submit was attempted on another (potentially full)
   node?
3. **Runtime / protocol version mismatch?** `contracts/managed/` was
   compiled 2026-04-21 (9 days before Mainnet attempts). Is there a
   Mainnet runtime version that requires re-compilation?
4. **Anti-spam policy on fresh wallets?** Wallet `mn_addr18ehfpzy7…`
   was registered for DUST recently and has not yet performed any
   on-chain transaction. Could Mainnet require some kind of
   "warm-up" TX (e.g. a NIGHT transfer or no-op) before contract
   deploy is accepted?

## Logs

Two raw runs preserved on disk:

- `logs/mainnet/2026-04-29T14:02:45.187Z.log` — attempt 5 (pre-fee-bump)
- `logs/mainnet/2026-04-29T18:18:59.651Z.log` — attempt 6 (post-fee-bump)
- `docs/deploy-mainnet-attempt6.log` — stdout of attempt 6 (this file)

Each shows the identical pattern:

```
Deploying gyotak-catch contract on Mainnet...
[01:48:30] INFO Deploying gyotak-catch contract...
2026-04-30 01:48:36 RPC-CORE: submitAndWatchExtrinsic … ExtrinsicStatus::
  1016: Immediately Dropped: The transaction couldn't enter the pool
  because of the limit
DEPLOY FAILED: SubmissionError: Transaction submission error
  at submissionService.js:31:279
  at effect/dist/esm/internal/core.js:520:33
  at effect/dist/esm/internal/fiberRuntime.js:945:41
```

## What works (for reference)

`scripts/check-mainnet-balance.ts` — same wallet seed, same network,
same SDK, same indexer. **Reliably succeeds** in 30-37 min and shows
DUST balance + UTXO. Proves the wallet itself is correctly synced and
observable; the failure is strictly at submit time.

This script's wallet-build path was transplanted into the rewritten
`src/mainnet.ts` for attempts 5 and 6, and that bypassed earlier
client-side hangs. Source-of-truth: the diff between
`api.buildWalletAndWaitForFunds` (which hangs) and
`scripts/check-mainnet-balance.ts` (which succeeds) is the basis for
hypothesis (3) above (some module-level side-effect interaction with
the deploy import graph).

## Build / runtime environment

- OS: Linux 6.6.87.2-microsoft-standard-WSL2 (Ubuntu under WSL2)
- Node.js: v22.11.0
- TypeScript: 6.0.3
- Loader: `ts-node/esm`

## Asks

If you can:

1. Look up node-side logs for submit attempts from
   `mn_addr18ehfpzy7hyyj4gm6kt7zkwkejc3sg629yr23tsvjs8kjaf754yvqetqsrz`
   on 2026-04-29 ~14:39 UTC and 2026-04-29 ~18:48 UTC.
2. Confirm whether `1016 Immediately Dropped` on this address is
   caused by mempool pressure, low priority, or a runtime validation
   failure.
3. Advise whether a re-compile of `contracts/managed/` against the
   current Mainnet runtime is needed before deploy will be accepted.

## Author

GYOTAK project — running Preview cron successfully (13 catch records
on-chain over 8 days) and attempting Mainnet migration.
