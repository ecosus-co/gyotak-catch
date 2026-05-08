# Forum Post: Mainnet 1016 Issue

Target: `forum.midnight.network/c/development`

---

**Title:** Mainnet contract deploy: 100% rejection with Substrate `1016 Immediately Dropped` despite empty pool, sufficient DUST, and 100× fee bump

**Body:**

Hi all — sharing a deterministic Mainnet deploy failure to see if anyone else hits the same wall, and to ask the core team for a node-side log lookup.

# Symptom

Compact contract deploy on Mainnet fails at submit with:

```
RPC-CORE: submitAndWatchExtrinsic(extrinsic: Extrinsic): ExtrinsicStatus::
1016: Immediately Dropped: The transaction couldn't enter the pool because of the limit

DEPLOY FAILED: SubmissionError: Transaction submission error
  at @midnight-ntwrk/wallet-sdk-capabilities/dist/submission/submissionService.js:31
```

7 attempts on **2026-04-29 (UTC)**, all failing at the same point. Client-side stages (sync, DUST detection, providers, ZK proof generation) all succeed; node submission is rejected ~5 seconds after `Deploying ...` log line.

# Setup

- Wallet (submitter): `mn_addr18ehfpzy7hyyj4gm6kt7zkwkejc3sg629yr23tsvjs8kjaf754yvqetqsrz`
- DUST balance: ~351,000 DUST in 1 UTXO (cross-wallet model: cNIGHT held in Cardano Lace wallet B, DUST registered to this Mainnet address)
- DUST balance is growing at the expected rate (+10k DUST in ~6 h via two reads of the indexer)
- Mainnet node version: `0.22.1-9ce45781`
- RPC: public `https://rpc.mainnet.midnight.network`
- SDK: `wallet-sdk-facade@3.0.0`, `wallet-sdk-dust-wallet@3.0.0`, `ledger-v8@8.0.3`, `compact-runtime@0.15.0`, `midnight-js@4.0.4`
- Proof server: local `:6300`
- Compact compiler: `0.5.1` (deterministic — recompile produced byte-identical artifacts)

> **Note:** SDK was upgraded after we identified and fixed 12 Iterator Helpers bugs (forum thread: https://forum.midnight.network/t/12-iterator-helpers-bugs-in-midnight-sdk-under-node-v22-array-from-workarounds-included/1184), so the rejection here is **not** from those known issues.

# Hypotheses ruled out

1. **Pool overflow** — `author_pendingExtrinsics` returns `[]` (empty) immediately before failed attempts.
2. **Fee priority** — `additionalFeeOverhead` raised 100× (0.3 → 30 DUST). Same identical rejection. SDK testkit default of `5e20` (500k DUST) exceeds my balance, but 100× should have moved the needle if priority were the cause.
3. **Insufficient balance** — 351k DUST is ~5 orders of magnitude above any expected fee.
4. **Wallet observability** — same wallet seed reads on-chain DUST UTXO correctly via `scripts/check-mainnet-balance.ts` (which I rewrote `src/mainnet.ts` to mirror, after `api.buildWalletAndWaitForFunds` had separate hang issues).
5. **ZK proof generation** — succeeds; the 1016 fires after proof gen.
6. **TX mortality** — 3.5+ hours between attempts; far beyond the 256-block (25 min) longevity window.
7. **Time of day** — tried both BKK afternoon (US morning UTC) and BKK early morning (US late afternoon UTC).

# Open questions for the team

1. Are deploys from a fresh wallet (no prior tx history) being throttled or filtered Mainnet-side?
2. Does the public RPC load-balance `submitAndWatchExtrinsic` to a different node than `author_pendingExtrinsics`, masking a per-node pool issue?
3. Is `1016` here actually pool-pressure, or is it Substrate's generic mapping for a runtime-validation rejection (e.g. `InvalidTransaction`)?
4. Is there node-side log visibility for submit attempts from `mn_addr18ehfpzy7…` around `2026-04-29 14:39 UTC`, `2026-04-29 18:48 UTC`, and `2026-04-29 19:27 UTC`?

# Question for other builders

Has anyone else successfully deployed a fresh Compact contract to Mainnet recently? If so:
- Was your submitter wallet "warmed up" with a prior tx (NIGHT transfer, etc.)?
- Did you see anything similar to 1016 along the way?
- Are you on public `rpc.mainnet.midnight.network` or a private node?

# What works (Preview track record)

**For context: GYOTAK has been running on Midnight Preview for 8 days with 13 catch records successfully recorded on-chain via a cron job** (publishing summary at https://gyotak-blog.pages.dev/). The Mainnet migration is the only blocker preventing production deployment.

`scripts/check-mainnet-balance.ts` (read-only wallet sync + DUST balance read) also works flawlessly with the same seed/network/SDK, confirming the wallet itself is correctly registered, observable, and funded. The blocker is strictly node-side at submit time.

Happy to share more detail on request — full logs, sanitised seed derivation path, etc.

— GYOTAK project (catch-record dapp on Midnight; Preview cron operational since 2026-04-21)
