<!--
  DRAFT — NOT SUBMITTED, NOT PUSHED.
  gyotak-catch v2 (plaintext fish manifest) Mainnet Deployment Request.
  Status (2026-06-04): v2 contract COMPILED (Vector<10>, §7 SHA-256 filled) and
  PREPROD-REHEARSED (§5 filled: deploy + recordCatch 5/10-slot byte-identical
  round-trip + owner-gate negative). Remaining «TBD»: Mainnet v2 address (filled
  only after authorization + deploy) and the git tag/evidence-archive paths.
  No Mainnet action has been taken to produce this file.

  Submission: AMEND the existing deployments/gyotak-catch.md via a PR titled
  "[Deployment Request] gyotak-catch v2 (plaintext fish manifest)" — dApp name /
  repo / owner are unchanged; only the contract schema + risk justification are
  revised. See "Submission guidance" at the end.
-->

# gyotak-catch v2 — Mainnet Deployment Authorization Application (Revision)

## 0. What changed since v1 (PR #96)

The v1 Score-1 contract (`contracts/gyotak-catch.compact`, Mainnet address
`e88a2a00b1d78ba1f2891c7017a4be8df2139da02328078fa4fc248b72fea2f4`) records one
catch per `batchId` with a single `fishSpecies: Bytes<32>` plaintext field. v2
adds a **fixed-size plaintext fish manifest** so that a single catch report
covering multiple species can publish each species *and its weight* on-chain.

The change is **additive and schema-bounded**:

- New ledger field on `CatchRecord`: `fishManifest: Vector<10, Bytes<32>>` — up to
  10 slots, each a UTF-8 `"romaji:weight"` string (e.g. `"Koro-Dai:20.8"`),
  zero-padded to 32 bytes; unused slots are all-zero. (10 slots leaves headroom
  over the observed maximum of 5 species per catch report.)
- `recordCatch` gains one argument (`fishManifest`) and discloses it into the
  record. No new witness, no new authority, no asset handling.
- All v1 invariants are retained verbatim: owner-gated writes, ±600 s block-time
  binding, duplicate-batchId rejection, GPS-as-witness (only `gpsHash` reaches
  the ledger). `fishSpecies` is retained for backward compatibility (existing
  readers, e.g. the invoice/catch-record link, keep working unchanged).

Because Compact has no in-place schema migration, v2 is a **new contract at a new
address**; v1 records remain at the v1 address. The operator publishes the v2
address alongside an address-change announcement (same procedure as any redeploy
documented in v1 §6 "Redeploy strategy").

## 1. Summary

ECOSUS CO., LTD. is a Pranburi-based Thai company operating GYOTAK, a
sashimi-grade flash-frozen fish brand serving both B2B and B2C channels. Our
product differentiator is end-to-end traceability: every batch is published with
provable origin metadata so customers and auditors can independently verify a
shipment. The applicant is Takuya Ogura, Chairman, ECOSUS CO., LTD.

v2 extends the published metadata from a single species label to a per-catch
manifest of up to ten `species:weight` entries, in cleartext, alongside the
unchanged GPS-hash / photo-hash commitments. We request Mainnet deployment
authorization for the v2 design described below.

### 1.1 Risk rubric (re-scored for v2)

| Category | v1 | v2 | Summary |
| --- | --- | --- | --- |
| Privacy-at-risk | 1 | **1** | The added data (species name + weight) is already public: it is printed on customer invoices, package labels, and the public catch blog. It is Tier-1 "data intended / already public" with no real-world harm and no PII. The only witness-held datum remains GPS coordinates, of which only `gpsHash` is disclosed — identical to v1. |
| Value-at-risk | 1 | **1** | The contract holds no on-chain assets — no tokens, NFTs, or escrowed value. The new field stores bytes, not value. Owner-gated writes are unchanged; an exploit cannot cause user fund loss. |
| State-space-at-risk | 1 | **1** | The manifest is a **compile-time fixed-size array** (`Vector<10, Bytes<32>>` = a hard 320-byte ceiling per record). Writes remain owner-gated and one-record-per-`batchId`, so growth tracks one legitimate operator's catch reports, not adversarial input. The per-record size increases by ≤320 bytes with a hard ceiling and no per-user unboundedness — squarely Tier-1 "bounded and static state, contract-enforced maximum". |

No category scores 3; the Launch Phased Deployment Override is not triggered.

## 2. Contract at a glance (v2)

Source: `contracts/gyotak-catch.compact` (v2), `pragma language_version >= 0.22`,
single file, no imports beyond `CompactStandardLibrary`.

Ledger record (the single added line is marked `// NEW`):

```compact
struct CatchRecord {
  gpsHash:      Bytes<32>,
  photoHash:    Bytes<32>,
  region:       Bytes<32>,
  catchDate:    Bytes<32>,
  fishSpecies:  Bytes<32>,             // retained: headline / primary species
  fishManifest: Vector<10, Bytes<32>>, // NEW: up to 10 "romaji:weight" plaintext slots
  committedAt:  Uint<64>,
}

export ledger batches: Map<Bytes<32>, CatchRecord>;
export ledger owner:   Bytes<32>;
```

Circuits (unchanged except `recordCatch`'s extra disclosed argument):

- `constructor(initialOwner)` — sets `owner` once at deploy.
- `recordCatch(batchId, region, catchDate, fishSpecies, fishManifest, photoHash, timestamp)`
  — owner-gated, ±600 s block-time bounded; discloses `fishManifest` into the record.
- `rotateOwner(newOwner)` — owner-gated; replaces `owner` atomically. **Unchanged**
  (circuit byte-identical to v1, see §7).
- `verifyCatch(batchId)` — read-only public lookup; now returns the manifest too.

The owner gate is byte-for-byte the v1 assertion:
`assert(disclose(publicKey(localSecretKey()) == owner), "unauthorized")`. The
witness model is unchanged: `getGpsCoords(batchId)` supplies GPS off-chain, only
`persistentHash(gps)` is stored; `localSecretKey()` loads the admin sk from a
mode-600 file with no default-key fallback.

## 3. Threat model

The adversary is any party holding NIGHT for fees and able to reach a proof
server. The asset at risk is ledger state space — growth of the `batches` map and
now the per-record manifest bytes.

v2 does not widen the attack surface relative to v1: the single owner-gate
assertion still precedes every `disclose` write, so an adversary cannot insert a
record at all, let alone an oversized one. The manifest is a fixed 10-slot vector,
so even the legitimate owner cannot exceed 320 manifest bytes per record. There
is no caller-controlled length, no loop, and no per-user accumulation.

## 4. State-space-at-risk Score 1 justification (v2)

**(a) Authentication.** Unchanged from v1: both write circuits assert
`publicKey(localSecretKey()) == owner` before any state change. Empirically
confirmed by F-6 below (non-owner write rejected at SDK simulation).

**(b) Bounded growth — now with a hard per-record ceiling.** The manifest is
`Vector<10, Bytes<32>>`, a compile-time fixed-size array. The maximum record size
is therefore a constant (5×`Bytes<32>` + `Uint<64>` + 10×`Bytes<32>`), independent
of input. No circuit path can grow a single record beyond this ceiling.

**(c) Time binding.** Unchanged: `recordCatch` enforces a ±600 s window via
`blockTimeGte(t-600)` / `blockTimeLte(t+600)`.

**(d) Rotation.** Unchanged: `rotateOwner` rotates the admin key without redeploy;
the v2 address is stable across rotations.

**Why plaintext disclosure is intentional and safe (justification requested by
reviewers).** Traceability is the product itself: GYOTAK's value proposition is
that any customer, auditor, or autonomous agent can verify a shipment's origin
*without trusting ECOSUS's own database*. Species and weight are already public —
they appear on the invoice, the package label, and the public catch blog — so
publishing them on-chain leaks nothing new; it merely makes the already-public
claim tamper-evident and independently checkable. Concretely, the GYOTAK Fish
Market MCP agent and end consumers resolve a package's `batchId` to the on-chain
`CatchRecord` and confirm species/weight against the physical label. Commercially
sensitive data (exact fishing coordinates) stays witness-side: only `gpsHash`
reaches the chain, exactly as in v1.

## 5. Empirical evidence (Preprod, 2026-06-04)

The v2 design was deployed and exercised on Preprod. The v2 contract address is
`374df4da76f1fde6b0d73d94d0bba01f90f7194e8b04d57320d2ba6b37cfecd5`; the owner
public key (pk-A) is
`5e8c984df5acc1948c6a9b969e92f6d1c237257a8cc0e4b629335ec6818dcc99`, derived from
the admin secret key via the same `publicKey(sk)` pure circuit as the contract.
Each row below is independently verifiable on the Preprod indexer.

| Step | Outcome | TX / Block | What it proves |
|---|---|---|---|
| E-1 | v2 contract deployed on Preprod | addr `374df4da…` (constructor) | Constructor wrote `owner = pk-A` |
| E-3 | Indexer query: `ledger.owner == pk-A` | byte-match (`verify-owner` → `OK: match`) | Constructor effect persisted on-chain |
| F-5 (POS) | `recordCatch` with a 5-slot manifest + 5 zero-pad | TX `00fbbe6e…122654` / block **1068810** | Multi-species write; all 10 slots round-trip **byte-identical** |
| F-9 (POS) | `recordCatch` with a **full 10-slot** manifest (decimal weights) | TX `00ecd76c…988cd2` / block **1068815** | Full-capacity write; all 10 slots round-trip **byte-identical** |
| F-6 (NEG) | `recordCatch` under non-owner sk-X | rejected, no chain effect | `failed assert: unauthorized` at SDK simulation; **no `/prove`, no submit, no dust consumed** |

**F-5 read-back (input → on-chain, byte-identical):**

```
[0] "Koro-Dai:20.8"     -> "Koro-Dai:20.8"      ✓
[1] "Kuro-Kanpachi:10"  -> "Kuro-Kanpachi:10"   ✓
[2] "Oni-Aji:1.5"       -> "Oni-Aji:1.5"        ✓
[3] "Umadsura-Aji:11"   -> "Umadsura-Aji:11"    ✓
[4] "Maguro:5"          -> "Maguro:5"           ✓
[5..9] <zero>           -> <zero>               ✓   ← subsumes F-10 (zero-padding round-trips losslessly)
```

**F-9 read-back (full 10 slots, decimal weights kept verbatim):**

```
[0] "Sp0:0.5" -> "Sp0:0.5"  ✓     [5] "Sp5:5.5" -> "Sp5:5.5"  ✓
[1] "Sp1:1.5" -> "Sp1:1.5"  ✓     [6] "Sp6:6.5" -> "Sp6:6.5"  ✓
[2] "Sp2:2.5" -> "Sp2:2.5"  ✓     [7] "Sp7:7.5" -> "Sp7:7.5"  ✓
[3] "Sp3:3.5" -> "Sp3:3.5"  ✓     [8] "Sp8:8.5" -> "Sp8:8.5"  ✓
[4] "Sp4:4.5" -> "Sp4:4.5"  ✓     [9] "Sp9:9.5" -> "Sp9:9.5"  ✓   ← subsumes F-11 (weights are not rounded)
```

**F-6 (owner gate).** With the witness `localSecretKey()` overridden to a
throwaway non-owner key `sk-X`, `recordCatch` is rejected by the wallet SDK's
local circuit simulation with `Error: failed assert: unauthorized` — before any
`/prove` request is issued and before any transaction is submitted, so no dust is
spent and `ledger.owner` is untouched. The same assertion would also fail at
proof generation and at chain settlement, giving three independent enforcement
layers (identical to v1 F-6/F-7).

**F-3 / F-8 (owner rotation) — re-run omitted; circuit proven byte-identical.**
The `rotateOwner` circuit is **unchanged** in v2: its compiled prover, verifier,
and ZKIR artefacts are byte-for-byte identical to v1 (see §7 — `rotateOwner.prover`
`ff4dcd6d…`, `rotateOwner.verifier` `7d06222e…`, `rotateOwner.zkir` `112835b8…`,
`rotateOwner.bzkir` `04747151…`, all matching the v1 fingerprints in
`deployments/gyotak-catch.md` §7). Because the rotation logic did not change, the
v1 F-3 (forward) / F-8 (rollback) evidence on Preprod carries over unchanged; a
fresh on-chain re-run would add no information. (A live re-run was additionally
gated by transient Preprod dust exhaustion — see the note below — but byte-identity
is the dispositive argument.)

**Note on `Custom error 170` during the rehearsal.** After F-5 and F-9, a third
sequential `recordCatch` in the same wallet session was rejected at submit with
`1010 Invalid Transaction: Custom error: 170`, and the wallet then showed
`dust.coins = 0`. This is **preprod fee-dust exhaustion** (the test wallet's
single ~5-DUST coin was consumed by the two successful records), **not** a
contract, schema, or SDK-version defect: the heavier 10-slot F-9 transaction
settled successfully on the same contract immediately before. On Mainnet the
deploy wallet holds ≈ 382,307 DUST (verified read-only on the Mainnet indexer),
so fee dust is not a constraint there.

Preprod v2 address: `374df4da76f1fde6b0d73d94d0bba01f90f7194e8b04d57320d2ba6b37cfecd5`.
Mainnet v2 address: «TBD (post-authorization)».

## 6. Operational posture

Unchanged from v1 except the contract schema. Admin sk custody, rotation
procedure, recovery model (seed = single source of truth, HD-derived sub-keys),
and the `docs/MAINNET-DEPLOY-CHECKLIST.md` ritual all carry over verbatim. The v2
Mainnet deploy reuses the v1 Mainnet wallet and the credentialed Foundation RPC
endpoint (`rpc.mainnet.midnight.foundation`) established during the v1 1016
remediation; that credential was re-verified live (read-only) and remains valid.
The v2 contract-address file is kept distinct (`.contract-address.mainnet.v2`) so
the live v1 deployment and its invoice link are untouched during cutover.

## 7. Source & build reproducibility

- **Repository**: https://github.com/ecosus-co/gyotak-catch (v2 tag «TBD»)
- **Compact source**: `contracts/gyotak-catch.compact` (v2), `language_version >= 0.22`
- **Compactc**: 0.30.0 · **language**: 0.22.0 · **runtime**: 0.15.0
  (recorded in `contracts/managed/compiler/contract-info.json`)
- **Build**: `compact compile contracts/gyotak-catch.compact contracts/managed`
- SDK / runtime semvers (unchanged from v1): `@midnight-ntwrk/ledger-v8` ^8.0.3,
  `@midnight-ntwrk/compact-runtime` ^0.15.0, `@midnight-ntwrk/midnight-js` ^4.0.4
  (and the provider packages at the same version). The added `fishManifest` field
  **compiles and submits cleanly under this toolchain**: it was recompiled and the
  v2 `recordCatch` settled on Preprod (F-5, F-9) on `ledger-v8 8.0.3`. Mainnet
  acceptance under the current Mainnet runtime (node `0.22.5-31b06338`) will be
  re-confirmed at deploy time.

SHA-256 fingerprints of the compiled v2 artefacts (`contracts/managed/`). The
`recordCatch` and `verifyCatch` circuits changed (the record struct gained a
field); `rotateOwner` is **byte-identical to v1**:

| File | SHA-256 | vs v1 |
|---|---|---|
| `keys/recordCatch.prover`   | `4aff8a57d8cdf2af094df3be4058105d2f8864d0cada71fcedd16af80ae71fd5` | changed |
| `keys/recordCatch.verifier` | `022446af5807440cf2ffe62df54401dc1613e4fccc0cacb6ade67801904f71fb` | changed |
| `keys/rotateOwner.prover`   | `ff4dcd6df8bc420592eb58ff5ae6e4a4a4bfbbb45a387aad1967242be7ef9e0c` | **identical** |
| `keys/rotateOwner.verifier` | `7d06222e211911d3ef2147cc982f13d90bb15981cc16823b6d5d340bb905632f` | **identical** |
| `keys/verifyCatch.prover`   | `7b808997438e4be74a07c016c8205f2873eb867ca84f2b885ceeba31c45c25c2` | changed |
| `keys/verifyCatch.verifier` | `9df90b684d3cf1c63b39233cb99280464b8c75c38bf4da241f309bdf645fb082` | changed |
| `zkir/recordCatch.zkir`     | `12862aee37ff22abea0085e5e563d414f7e1dd9b6c47ce8cc28abc3c2b002bdd` | changed |
| `zkir/recordCatch.bzkir`    | `ec8b1dac746840873d98f2f96896502b186ffe18a1705f1a94defb8ad920d598` | changed |
| `zkir/rotateOwner.zkir`     | `112835b845811f9b87c3970a2f55f7d3c51b77646f463ec725e5ea0d3503d7a0` | **identical** |
| `zkir/rotateOwner.bzkir`    | `04747151c77eb8a9ac3ba925b72701f9c4e87e0b097c15b60f2a9ab46b355b18` | **identical** |
| `zkir/verifyCatch.zkir`     | `7ecf5b9ebd1d6b3f2d9cd5ccfb7de62bb307509bb98829be3553c6759ff116f6` | changed |
| `zkir/verifyCatch.bzkir`    | `89a6d48c98dc47f4f4a96d32df77b7d7b8abc1d381cbee62b0d5224d44155506` | changed |

The `recordCatch` prover grew from 2,826,769 bytes (v1) to 5,203,391 bytes (v2),
reflecting the larger fixed-size manifest circuit. The four byte-identical
`rotateOwner` fingerprints are the basis for omitting a fresh F-3/F-8 re-run (§5).

## 8. Companion documents

- `docs/MAINNET-DEPLOY-CHECKLIST.md` — operational procedure (carries over).
- v1 application: `deployments/gyotak-catch.md` (PR #96) — this revision supersedes
  the contract-design sections while retaining v1 as historical baseline.
- v2 Preprod evidence: deploy + `verify-owner` (E-1/E-3), `recordCatch` F-5/F-9
  read-back logs, and F-6 owner-gate rejection (archive path «TBD»).

---

## Submission guidance (not part of the PR body)

**Recommended: amend `deployments/gyotak-catch.md`** with the content above,
opened as a PR titled **`[Deployment Request] gyotak-catch v2 (plaintext fish
manifest)`**. Rationale: the rubric keys deployment files by dApp, and the dApp
name, repository, owner, and purpose are unchanged — only the contract schema and
its risk justification are revised. Amending keeps one canonical file per dApp and
preserves the v1 → v2 audit trail in git history.

Alternative (only if reviewers prefer per-version files): create
`deployments/gyotak-catch-v2.md`. Avoid this unless asked; it fragments the dApp's
record.

**Remaining items before / around submission:**
1. ✅ Compile v2 contract → §7 SHA-256 fingerprints filled.
2. ✅ Preprod rehearsal → §5 evidence filled (E-1/E-3, F-5, F-9, F-6; F-3/F-8 by
   circuit byte-identity).
3. ⏳ Confirm with the Foundation that the existing credentialed RPC / guarded-launch
   authorization covers a new v2 contract address from the same wallet (the
   credential is endpoint/account-scoped, so technically yes — confirm policy).
4. ⏳ Mainnet deploy of v2 → fill the Mainnet v2 address (only after authorization).
5. ⏳ Cutover plan for the existing v1 history (dual-address vs re-record) and the
   `catch_reports.fish_items` → manifest wiring in `mirror-pending.ts` (implemented
   in the v2 working copy; cutover deferred to post-deploy).
