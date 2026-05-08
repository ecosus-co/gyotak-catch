# gyotak-catch Mainnet Deployment Checklist

**Scope.** Operational checklist for deploying the owner-gated `gyotak-catch`
contract (Compact 0.22, State-space-at-risk Score 1) to Midnight Mainnet,
including the Preprod rehearsal that establishes the evidence base for the
Mainnet deployment authorization application.

**Status.** This document is a procedure. Execution of the steps below is
performed manually by the operator on Preprod, then on Mainnet after the
deployment authorization is granted. No real secret keys, derived public
keys, or new addresses are written into this file.

**Reference contract address (historic).** The Score-3 Preprod implementation
documented in `ECOSUS-TR-2026-002` is on-chain at
`a3f3a04476914b86eb914a4e3626519b1538395901fd376442a1fa8afffe836f`
(deployed 2026-05-07). It is referenced in the application as the predecessor
design, and its address file should be retained as historical record.

**Network identifier.** Midnight JS SDK uses `type NetworkId = string`. The
literal value for Preprod is `'preprod'`; for Mainnet, `'mainnet'`. Both
match the strings used in `src/config.ts` (`PreprodConfig` /
`MainnetConfig`) and `scripts/show-balance.mjs`. The SDK exposes no enum;
queries that need the network id must pass the same literal that the
contract was deployed with.

---

## A. Pre-generation environment checks

```bash
# A-1. Refuse to proceed if the secrets directory already exists
test -e ~/midnight/.gyotak-secrets \
  && echo "STOP: ~/midnight/.gyotak-secrets exists — review contents before deciding" \
  || echo "OK: not yet created"

# A-2. Conflict check (only if A-1 reported existence)
ls -la ~/midnight/.gyotak-secrets/ 2>/dev/null

# A-3. Entropy source verification
openssl version                                            # OpenSSL >= 1.1.1 expected
test -c /dev/urandom && echo "/dev/urandom OK" || echo "STOP: /dev/urandom unavailable"
cat /proc/sys/kernel/random/entropy_avail 2>/dev/null      # WSL2 always reports a large value
```

**Entropy source decision.** `openssl rand -hex 32` is sufficient: OpenSSL
≥ 1.1.1 derives via DRBG seeded from `/dev/urandom`, which on WSL2 is the
real Linux kernel CSPRNG. `head -c 32 /dev/urandom | xxd -p -c 64` is a
direct alternative with identical cryptographic strength.

**Stop condition.** Existing secrets directory or missing `/dev/urandom` →
do not proceed.

---

## B. Key generation and storage

```bash
# B-1. Tighten umask before creating anything
umask 077
mkdir -p ~/midnight/.gyotak-secrets
stat -c '%a %n' ~/midnight/.gyotak-secrets        # expect "700 ..."

# B-2. Generate the secret key (no terminal echo)
openssl rand -hex 32 > ~/midnight/.gyotak-secrets/admin-sk.txt

# B-3. Lock down permissions and verify
chmod 600 ~/midnight/.gyotak-secrets/admin-sk.txt
stat -c '%a %U:%G %n' ~/midnight/.gyotak-secrets/admin-sk.txt
# expect "600 <user>:<group> /home/<user>/midnight/.gyotak-secrets/admin-sk.txt"
# Anything other than 600 → STOP

# B-4. Format sanity (64 hex chars + newline = 65 bytes)
wc -c ~/midnight/.gyotak-secrets/admin-sk.txt                              # expect 65
grep -cE '^[0-9a-f]{64}$' ~/midnight/.gyotak-secrets/admin-sk.txt          # expect 1

# B-5. Confirm the secret never reached shell history
history | grep -i 'admin-sk\|secret\|hex 32' | head -20
# Any matches → `history -d <line>` and inspect ~/.bash_history
```

### B-6. Physical backup (in priority order)

| Method | Recommended | Notes |
|---|---|---|
| Hand-written on paper, kept in a fire-safe | Strongly | Group hex into 8-char blocks to reduce transcription error. Plain hex (not BIP-39 mnemonic) is symmetric, so partial fragments still leak the whole key — store as a single artifact, not split |
| Hardware wallet (Ledger, etc.) used as a generic seed store | Strongly | Confirm the device supports importing arbitrary 32-byte hex. Some firmware accepts only BIP-39 mnemonics |
| Encrypted USB (VeraCrypt, etc.) holding the hex file | Acceptable | Maintain at least two devices in physically separated locations |
| Reputable password manager (1Password, Bitwarden) | Limited | Fine for Preprod. For Mainnet, prefer paper or hardware backup |
| `/mnt/c/`, OneDrive, iCloud, Google Drive, plaintext clipboard | **Forbidden** | NTFS does not honour POSIX modes; cloud sync exposes the key |
| Windows `clip.exe`, RDP/SSH paste | **Forbidden** | Bridges WSL2 to host processes |

### B-7. Backup verification checkpoint

```bash
# Restore from the backup into a temporary file and compare
# (For paper backup, retype manually — do not OCR via the network.)
diff /tmp/restored-sk.txt ~/midnight/.gyotak-secrets/admin-sk.txt
# No output = match. Then immediately remove the temp file:
shred -u /tmp/restored-sk.txt
```

**Stop condition.** B-3 mode ≠ 600, B-4 not exactly 1 line of 64 hex, or
B-7 diff non-empty → do not proceed.

---

## C. Verifying derive-owner-pk

```bash
cd ~/midnight/gyotak-catch

# C-1. Determinism (the same sk must yield the same pk on every call)
pk1=$(PATH=/home/takuya/.local/node22/bin:$PATH \
  npm run --silent preprod -- derive-owner-pk 2>/dev/null \
  | grep -E '^[0-9a-f]{64}$' | head -1)
pk2=$(PATH=/home/takuya/.local/node22/bin:$PATH \
  npm run --silent preprod -- derive-owner-pk 2>/dev/null \
  | grep -E '^[0-9a-f]{64}$' | head -1)
echo "pk1=$pk1"
echo "pk2=$pk2"
[[ -n "$pk1" && "$pk1" == "$pk2" ]] && echo "OK: deterministic" || echo "STOP"

# C-2. Length check
echo -n "$pk1" | wc -c                            # expect 64
echo -n "$pk1" | grep -cE '^[0-9a-f]{64}$'        # expect 1

# C-3. Save the public key for downstream steps (pk is non-secret)
echo "$pk1" > /tmp/pk-preprod.txt
```

**Stop condition.** pk1 ≠ pk2, length ≠ 64, or empty output → bug in the
witness wiring or pureCircuits invocation.

---

## D. Pre-deploy validation

```bash
cd ~/midnight/gyotak-catch

# D-1. Compactc output is fresher than the source
stat -c '%Y %n' contracts/gyotak-catch.compact contracts/managed/contract/index.d.ts
# d.ts mtime must be >= source mtime; if older, rerun: npm run build:contract

# D-2. TypeScript typecheck clean
PATH=/home/takuya/.local/node22/bin:$PATH npm run typecheck       # 0 errors expected

# D-3. Wallet sync, tNight balance, DUST balance
PATH=/home/takuya/.local/node22/bin:$PATH node scripts/show-balance.mjs preprod
# tNight > 0 AND DUST > 0 expected; otherwise top up via faucet and wait for cold sync

# D-4. Hosted Preprod proof-server reachable
curl -fsS -o /dev/null -w "%{http_code}\n" https://proof-server.preprod.midnight.network/ \
  || echo "STOP: proof-server unreachable"

# D-5. Archive the historic Preprod address file before deploy overwrites it
ls -la .contract-address.* 2>/dev/null
mv .contract-address.preprod \
   ".contract-address.preprod.bak-pre-score1-$(date +%Y%m%d-%H%M%S)" 2>/dev/null \
  && echo "OK: previous address file archived" \
  || echo "info: no previous address file"

# D-6. Git working tree clean (only if the project is a git repo)
test -d .git && git status --porcelain || echo "info: .git not initialized"

# D-7. Final pk re-derivation matches what we are about to submit
PATH=/home/takuya/.local/node22/bin:$PATH \
  npm run --silent preprod -- derive-owner-pk 2>/dev/null \
  | grep -E '^[0-9a-f]{64}$' | head -1 \
  | tee /tmp/pk-preprod-final.txt
diff /tmp/pk-preprod.txt /tmp/pk-preprod-final.txt          # no diff expected
```

**Stop condition.** Any of D-1 through D-4 fails, or D-7 diff is non-empty → do
not deploy.

---

## E. Deploy and on-chain owner verification

```bash
cd ~/midnight/gyotak-catch
PK=$(cat /tmp/pk-preprod-final.txt)
echo "DEPLOYING with initial-owner = $PK"

# E-1. Deploy on Preprod
PATH=/home/takuya/.local/node22/bin:$PATH \
NODE_OPTIONS='--max-old-space-size=8192' \
  npm run deploy:preprod -- --initial-owner "$PK" 2>&1 \
  | tee deploy-preprod-score1-$(date +%Y%m%d-%H%M%S).log
# Success indicator: log line "Saved contract address." plus a fresh
# .contract-address.preprod file in the repo root.

# E-2. New address file confirmation
cat .contract-address.preprod
ADDR=$(cat .contract-address.preprod)
echo "new contract address: $ADDR"

# E-3. Verify on-chain ledger.owner equals the public key we submitted.
# NetworkId is the string literal 'preprod' — the SDK exposes no enum.
PATH=/home/takuya/.local/node22/bin:$PATH \
node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm \
  -e "
  import('@midnight-ntwrk/midnight-js-network-id').then(async ({ setNetworkId }) => {
    setNetworkId('preprod');
    const { PreprodConfig } = await import('./src/config.js');
    const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
    const { ledger } = await import('./contracts/managed/contract/index.js');
    const cfg = new PreprodConfig();
    const p = indexerPublicDataProvider(cfg.indexer, cfg.indexerWS);
    const s = await p.queryContractState('$ADDR');
    const onchain = Buffer.from(ledger(s.data).owner).toString('hex');
    console.log('on-chain owner =', onchain);
    console.log('expected      =', '$PK');
    console.log(onchain === '$PK' ? 'OK: match' : 'MISMATCH');
    process.exit(0);
  });
  "
# The final line must read "OK: match". Anything else → STOP.
```

**Stop condition.** E-1 submission fails (root pruning, fee, persistence) →
restore the archived address file and investigate. **E-3 mismatch → STOP
immediately, destroy the secret key, and restart from A.** A wrong on-chain
owner is unrecoverable through any built-in path.

---

## F. Rotation rehearsal (Preprod, mandatory before Mainnet)

This is the evidence base for the Mainnet deployment authorization
application: it demonstrates that owner-gated writes succeed for the legitimate
key holder and fail for everyone else, and that the rotateOwner path is
operational.

```bash
# F-1. Generate a throwaway sk-B (will be destroyed at the end of the rehearsal)
mkdir -p ~/midnight/.gyotak-secrets-rehearsal
chmod 700 ~/midnight/.gyotak-secrets-rehearsal
openssl rand -hex 32 > ~/midnight/.gyotak-secrets-rehearsal/admin-sk-B.txt
chmod 600 ~/midnight/.gyotak-secrets-rehearsal/admin-sk-B.txt

# F-2. Derive pk-B
PK_B=$(GYOTAK_MIDNIGHT_ADMIN_SK_FILE=~/midnight/.gyotak-secrets-rehearsal/admin-sk-B.txt \
  PATH=/home/takuya/.local/node22/bin:$PATH \
  npm run --silent preprod -- derive-owner-pk 2>/dev/null \
  | grep -E '^[0-9a-f]{64}$' | head -1)
echo "pk-B = $PK_B"

# F-3. With sk-A in place, rotate to pk-B
PATH=/home/takuya/.local/node22/bin:$PATH \
  npm run preprod -- rotate-owner --new-owner "$PK_B"
# On success, ledger.owner becomes pk-B.

# F-4. Re-run the on-chain verification one-liner from E-3 with expected = $PK_B.

# F-5. POSITIVE: with sk-B installed, recordCatch succeeds
mv ~/midnight/.gyotak-secrets/admin-sk.txt ~/midnight/.gyotak-secrets/admin-sk.A.suspended
cp ~/midnight/.gyotak-secrets-rehearsal/admin-sk-B.txt ~/midnight/.gyotak-secrets/admin-sk.txt
chmod 600 ~/midnight/.gyotak-secrets/admin-sk.txt
PATH=/home/takuya/.local/node22/bin:$PATH \
  npm run record-catch:preprod -- ROTATE-TEST-B-001 Bangkok 2026-05-08 \
    TestFish https://placehold.co/200x200.png 13.7563 100.5018
# Tx must finalize.

# F-6. NEGATIVE: a third-party sk-X must be rejected
openssl rand -hex 32 > /tmp/admin-sk-X.txt
chmod 600 /tmp/admin-sk-X.txt
GYOTAK_MIDNIGHT_ADMIN_SK_FILE=/tmp/admin-sk-X.txt \
PATH=/home/takuya/.local/node22/bin:$PATH \
  npm run record-catch:preprod -- NEG-TEST-X-001 Bangkok 2026-05-08 \
    TestFish https://placehold.co/200x200.png 13.7563 100.5018
# Expected: stderr/log contains "unauthorized" assertion failure; tx is NOT submitted.
shred -u /tmp/admin-sk-X.txt

# F-7. NEGATIVE: rotateOwner from a third-party key must also be rejected
openssl rand -hex 32 > /tmp/admin-sk-X-2.txt
chmod 600 /tmp/admin-sk-X-2.txt
GYOTAK_MIDNIGHT_ADMIN_SK_FILE=/tmp/admin-sk-X-2.txt \
PATH=/home/takuya/.local/node22/bin:$PATH \
  npm run preprod -- rotate-owner \
    --new-owner 0000000000000000000000000000000000000000000000000000000000000000
# Expected: same "unauthorized" assertion failure; ledger.owner unchanged.
shred -u /tmp/admin-sk-X-2.txt

# F-8. Roll back to pk-A (with sk-B still installed)
PK_A=$(cat /tmp/pk-preprod-final.txt)
PATH=/home/takuya/.local/node22/bin:$PATH \
  npm run preprod -- rotate-owner --new-owner "$PK_A"
# Re-verify on-chain owner equals pk-A.

# F-9. Restore sk-A as the active admin secret key
rm ~/midnight/.gyotak-secrets/admin-sk.txt
mv ~/midnight/.gyotak-secrets/admin-sk.A.suspended ~/midnight/.gyotak-secrets/admin-sk.txt
chmod 600 ~/midnight/.gyotak-secrets/admin-sk.txt

# F-10. Securely destroy the rehearsal sk-B
shred -u ~/midnight/.gyotak-secrets-rehearsal/admin-sk-B.txt
rmdir ~/midnight/.gyotak-secrets-rehearsal
```

**Stop condition.** F-3 or F-8 submission failure / F-5 unauthorized rejection
of the legitimate caller / **F-6 or F-7 succeeding (= bypass)** → halt
immediately. F-6 / F-7 succeeding indicates the access-control logic is broken
and the contract is not Score 1.

**Evidence to retain for the application.** The complete logs of F-3 (rotate
to pk-B), F-5 (positive recordCatch under pk-B), F-6 (negative recordCatch
under sk-X with explicit "unauthorized" assertion), F-7 (negative
rotate-owner under sk-X-2), and F-8 (rollback to pk-A). These collectively
demonstrate that owner-gated writes are enforced at proof generation and at
ledger settlement.

---

## G. Mainnet pre-deployment gate

| Gate | Verification |
|---|---|
| All three Preprod circuits (`recordCatch`, `rotateOwner`, `verifyCatch`) finalized successfully | Logs from F-3, F-5, F-8, plus an existing `verify-catch:preprod` run |
| Preprod admin-sk and Mainnet admin-sk are independent artefacts | Generate the Mainnet key via the A → B flow into a separate path (e.g. `~/midnight/.gyotak-secrets-mainnet/admin-sk.txt`); confirm `diff` against the Preprod sk reports differences. Switch active key via the `GYOTAK_MIDNIGHT_ADMIN_SK_FILE` environment variable |
| Mainnet NIGHT acquired and visible in the deploy wallet | Lace wallet receive address → Glacier Drop or exchange withdrawal → confirm balance via `scripts/show-balance.mjs mainnet` |
| Proof-server choice (hosted vs. self-hosted) finalized | Hosted Mainnet proof-server URL recorded in environment; self-hosted only if a specific operational reason exists |
| `mainnet.ts` cost parameters appropriate for current chain conditions | Current setting: `additionalFeeOverhead: 30_000_000_000_000_000n` (30 DUST). Compare against the prevailing fee floor at deploy time |
| Application attachments compiled | New Preprod address from E-2 + Mainnet address (post-deploy) listed alongside the historic Preprod address (`a3f3a0...e836f`) in the technical report |
| Backups for Preprod sk and Mainnet sk are physically separated | Different envelopes inside the safe, different USB devices, or different password-manager vaults; never co-located in a single artefact |

**Final stop condition.** Any uncompleted F-step / Preprod sk re-used as
Mainnet sk / backup integrity unverified → Mainnet deployment is not
authorized to proceed.

---

## Appendix: airgap key generation for Mainnet

Maximum-assurance posture: generate the Mainnet `admin-sk` on an
**airgapped machine** (Tails USB or a dedicated offline Linux host), back it
up to paper at the airgap, derive the public key on the same airgap,
transport only the public key (paper or QR code) to the deployment host. The
secret never touches a networked machine.

The Preprod rehearsal documented above runs on the regular WSL2 host because
its sole purpose is to produce evidence for the application. The Mainnet
ritual should follow the airgap path described here.
