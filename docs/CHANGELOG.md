# gyotak-catch CHANGELOG

変更管理方針: このプロジェクトは `.env` に秘密鍵 (WALLET_SEED / CF_API_TOKEN) を含むため git 管理していません。
変更はファイルバックアップ (`<file>.bak-YYYYMMDD-<phase-step>`) と本 CHANGELOG で追跡しています。

## 2026-04-21 Phase 2-Step 2: D1 realignment with on-chain truth

### Context
Phase 1 調査で判明した「D1 と Midnight on-chain の乖離」4 行を修復する one-shot スクリプトを作成・実行。`--apply` により D1 に UPDATE を 4 件打ち、その後 contract の `batches` ledger を `getCatchLedgerState` で読み取って photoHash の一致を 4/4 確認した。Phase 2-Step 1 (mirror-pending の `already_on_chain` 対応) が既にデプロイ済みなので、次回以降の再発はスクリプト自身で自己治癒する。

対象 4 行:
- `b8037b5c` img1 (c6a422d3, image_hash 63116038…): 原因 A 由来。`cli record-catch` 手動実行 (2026-04-20 23:48:25 UTC, block 387984, tx 00b2241826a0…) で on-chain に載っていたが cli が D1 write-back を持たないため `pending`/全 null のまま放置されていた。
- `0cbe346d` img1 (c48ed166, 0ec3aae6…): 原因 C+D 由来。2026-04-21 06:41:21 UTC に mirror-pending で markConfirmed 成功 (tx 004b45d9…, block 392113) 後、何かが status を pending に戻し、06:52 の cron 再実行で "catch already exists" → `markFailed` が status='failed' で上書き。tx_hash / block / confirmed_at は confirmed 時の値が保持されていた。
- `7559d7df` img1 (067a19d4, 294bee16…): 同上。tx 007a4ae6…, block 392119。
- `7559d7df` img2 (ff588f96, 7fd3bf24…): 同上。tx 00743de5…, block 392125。

### Changes
- 新規: `scripts/realign-d1-with-chain.ts` (約 310 行)
  - One-shot。cron には入れない。`--apply` がない限り dry-run。
  - TARGETS 配列に 4 行分の (image_row_id / catch_report_id / image_hash_prefix / batch_id_expected / fields / source_notes) をハードコード。
  - `d1Query` / `fetchCurrentImageState` / `formatSnapshot` / `diffToPlan` / `applyOne` / `verifyOnChain` / `main` の 7 関数構成。
  - `applyOne` の UPDATE は `WHERE id = ? AND image_hash LIKE 'prefix%'` の二重ガード。
  - `verifyOnChain` は `api.getCatchLedgerState` で読み取り専用照会（proof/tx/手数料なし）。
- D1 UPDATE 4 件を実行（下記 Verified realigned rows）。

### Verification
- `tsc --noEmit`: EXIT=0 (scripts/ を include に含めた設定で 3 ファイル全部チェック)
- dry-run: 2026-04-21 11:48 UTC 頃、Before スナップショットと PLAN が 4 行分正しく表示されることを確認 (`/tmp/realign-dry-run.log`)
- apply: 2026-04-21 12:13 UTC 実行 (`/tmp/realign-apply.log`)。EXIT=0。Phase B After の値が 4 行全部 PLAN と完全一致。
- Phase C on-chain verification (apply の最後で実行): **4/4 MATCH**
  ```
  CR-20260420-b8037b5c: OK — photoHash on-chain matches prefix 63116038094ee6f0
  CR-20260421-b49839c9: OK — photoHash on-chain matches prefix 0ec3aae64cf8f334
  CR-20260421-d22e8d85: OK — photoHash on-chain matches prefix 294bee16911d25e2
  CR-20260421-d8f6b8fe: OK — photoHash on-chain matches prefix 7fd3bf24b79742d5
  ```

### Verified realigned rows

| row | Before status | Before tx_hash / block | After status | After (すべて DIFF から再取得) |
|---|---|---|---|---|
| c6a422d3 (b8037b5c img1) | pending, batch_id=null, tx/block=null | — / — | **confirmed** | batch=CR-20260420-b8037b5c, tx=00b2241826a0ca158766a28f2dbbdb77de420bcaf55e91899dcf98575855a14214, block=387984, confirmed_at=1776728905544 |
| c48ed166 (0cbe346d img1) | failed, error="catch already exists" | 004b45d9…/ 392113 | **confirmed** | tx/block/confirmed_at 変化なし、error=null |
| 067a19d4 (7559d7df img1) | failed, error="catch already exists" | 007a4ae6… / 392119 | **confirmed** | tx/block/confirmed_at 変化なし、error=null |
| ff588f96 (7559d7df img2) | failed, error="catch already exists" | 00743de5… / 392125 | **confirmed** | tx/block/confirmed_at 変化なし、error=null |

### Final D1 state summary (8 行全部)

| report | row | image_hash prefix | batch_id | status | tx_hash prefix | block |
|---|---|---|---|---|---|---|
| b8037b5c | c6a422d3 | 63116038094ee6f0… | CR-20260420-b8037b5c | **confirmed** | 00b2241826a0ca15… | **387984** |
| b8037b5c | 150e6e04 | 66ab04b9ba70bc9f… | (null) | pending | (null) | (null) |
| 0cbe346d | c48ed166 | 0ec3aae64cf8f334… | CR-20260421-b49839c9 | **confirmed** | 004b45d9c6e13d3c… | **392113** |
| 7559d7df | 067a19d4 | 294bee16911d25e2… | CR-20260421-d22e8d85 | **confirmed** | 007a4ae66fc3878a… | **392119** |
| 7559d7df | ff588f96 | 7fd3bf24b79742d5… | CR-20260421-d8f6b8fe | **confirmed** | 00743de52ad9a7b1… | **392125** |
| 4ecd5aba | 50bd9847 | 1b3215936c6029b9… | (null) | pending | (null) | (null) |
| 4ecd5aba | 2e593e06 | 68cfaecbc87b2000… | (null) | pending | (null) | (null) |
| 72eb7208 | ac6cac51 | 0eb029788f62195f… | (null) | pending | (null) | (null) |

on-chain 登録率: **4/8 (50%)** → 修復後も batch_id=null の 4 行は未登録のまま。Phase 2-Step 3 のスコープ。

### Out of scope
- batch_id=null の 4 行 (b8037b5c img2, 4ecd5aba img1/img2, 72eb7208 img1) → Phase 2-Step 3 で batch_id 付与 + mirror-pending による submit
- 原因 A の恒久修正 (`cmdRecordCatch` が D1 write-back しない) → 要対応だが今回スコープ外
- 原因 B の恒久修正 (`fetchPending` の `batch_id IS NOT NULL` 除外) → 要対応だが今回スコープ外
- 原因 C の調査 (Worker 側で confirmed→pending に戻す process) → Windows 担当

### Next
Phase 2-Step 3 で残り 4 行の batch_id 付与と submit を実行すれば、全 8 行が on-chain 済みになる想定。

### Rollback procedure (万が一)
各 UPDATE は個別に戻せる（Before の値が `/tmp/realign-dry-run.log` と `/tmp/realign-apply.log` に記録済み）。下記 SQL を CF_API_TOKEN を使った D1 REST で打てば復元:
```sql
-- Row 1 (c6a422d3): 全フィールド戻し
UPDATE catch_report_images
SET batch_id=NULL, midnight_status='pending', midnight_tx_hash=NULL,
    midnight_block_number=NULL, midnight_confirmed_at=NULL
WHERE id='c6a422d3-749f-4a5f-aa93-aa7735c93fbc';

-- Row 2-4 (c48ed166, 067a19d4, ff588f96): status / error のみ戻し
UPDATE catch_report_images SET midnight_status='failed',
    midnight_error='Unexpected error executing scoped transaction ''<unnamed>'': Error: failed assert: catch already exists'
WHERE id IN ('c48ed166-0daa-4909-a315-8006a3af135e', '067a19d4-8247-4f2b-b897-73d1d0102f6b', 'ff588f96-c4cb-4fba-9752-ad722e5356b2');
```
ただし Phase 2-Step 1 で `mirror-pending.ts` が `already_on_chain` を自動検出するよう修正済みなので、ロールバックしても次の cron で再度 confirmed に戻る（= ロールバックは事実上不可能であり、それ自体が本修正の正しさの裏返し）。


## 2026-04-21 Phase 2-Step 1: already_on_chain handling

### Context
Phase 1 調査で判明した原因 D（`"catch already exists"` が `row_failure` 扱いで `markFailed` が `confirmed` を上書き）の再発防止。加えて「既に on-chain だが D1 が failed 扱い」の状態を mirror-pending 自身が自己治癒できる pre-check ロジックを追加。

- 原因 D の一次症状: `0cbe346d` / `7559d7df` の 3 行で `midnight_status='failed'`, `midnight_error='...catch already exists'` だが `midnight_tx_hash` と `midnight_block_number` が過去の confirmed から残ったまま (= 実データは on-chain)。
- この修正は「確信を持って on-chain と判定できる行を `confirmed` に戻す」防御であり、**既存の嘘 failed 行を healing するのは Phase 2-Step 2 の realignment スクリプトが別途担当**。ただし原因 C が再発して行が `pending` に戻った時は本修正が自己治癒する (pre-check pass)。

### Changes

1. **tsconfig.json**
   - `include` に `"scripts/**/*.ts"` を追加
   - 目的: `mirror-pending.ts` を `tsc --noEmit` の型検査対象に入れる
   - backup: `tsconfig.json.bak-20260421-p2s1-AFTER` (= 編集後状態のバックアップ)
   - diff:
     ```diff
     -  "include": ["src/**/*.ts", "contracts/managed/contract/index.d.ts"],
     +  "include": ["src/**/*.ts", "scripts/**/*.ts", "contracts/managed/contract/index.d.ts"],
     ```

2. **scripts/mirror-pending.ts**
   - backup: `scripts/mirror-pending.ts.bak-20260421-p2s1` (= 編集前状態のバックアップ)
   - 追加 import
     - `textToBytes32`, `hexFromBytes` from `../src/cli.js`（batchId を 32-byte hex に変換するため）
     - `type GyotakCatchProviders` from `../src/common-types.js`（`isAlreadyOnChain` の型用）
   - `ErrCategory` 型に `'already_on_chain'` を追加
   - `categorizeError()` に判定を追加: `msg.includes('catch already exists') || msg.includes('already exists')` → `'already_on_chain'` を返す。`row_failure` フォールバックより前・`insufficient_funds` の後に配置。
   - `markAlreadyOnChain(id)` を追加 — `UPDATE catch_report_images SET midnight_status='confirmed', midnight_error=NULL WHERE id=?`。**tx_hash / block_number / confirmed_at には触らない** (過去の markConfirmed 結果を保持)。
   - `isAlreadyOnChain(providers, contractAddress, batchId)` を追加 — `api.getCatchLedgerState` で contract の `batches` map を照会する読み取り専用ヘルパー（proof 生成なし、tx なし、手数料なし、~100-500ms）。
   - main() のコアループを修正:
     - `contractAddress` をループ外で 1 回読む（joinContract と共有）
     - markSubmitting の**直前に pre-check ブロック**追加: 既に on-chain なら submit をスキップし `markAlreadyOnChain` → `recovered++` → `continue`。pre-check 自体が失敗した場合 (indexer 一時不可など) は log して通常 submit にフォールスルー。
     - catch ブロックの**先頭** (`proof_server_down` より前) に `'already_on_chain'` カテゴリ分岐を追加: `markAlreadyOnChain` → `recovered++` → `continue`。これで `markFailed` に到達せず confirmed 行を failed で上書きしない。
   - `recovered` カウンタを `success` と並列に追加
   - 終了ログと stdout の両方で `success=N recovered=M failed=K` 形式に統一（早期 exit path の `console.log('success=0 failed=0')` も `success=0 recovered=0 failed=0` に合わせた）

### Intentionally out of scope
本 commit では以下には手を付けない:
- 原因 A (`cmdRecordCatch` が D1 write-back しない) — Phase 2 の別ステップ
- 原因 B (`fetchPending` が `batch_id IS NOT NULL` で除外) — Phase 2 の別ステップ
- 原因 C (外部プロセスによる status='confirmed' → 'pending' リセット) — Worker (Windows 担当)
- Realignment (既に failed になっている 3 行と、batch_id=null のまま on-chain 済みの b8037b5c img1) — Phase 2-Step 2

### Verification

- **`tsc --noEmit`**: EXIT=0（エラーゼロ。tsconfig.json 変更により scripts/ も検査対象に入った状態で PASS）
- **dry-run** (`node --no-warnings --loader ts-node/esm scripts/mirror-pending.ts`): EXIT=0
  ```
  [2026-04-21T11:42:59.037Z] mirror-pending starting (limit=5)
  [2026-04-21T11:42:59.590Z] no pending rows; nothing to do
  success=0 recovered=0 failed=0
  ```
  予想通り「no pending rows」。現在の D1 pending 行 5 件は全て `batch_id=null` のため `fetchPending` の `batch_id IS NOT NULL` フィルタで除外されるため、pre-check 経路は発火しない。これは原因 B が未対応なだけで、本修正の正常動作を否定しない。
- 副作用: なし。D1 への書き込みも contract への tx も発生していない (rows.length===0 で早期 return)。

### Rollback procedure
問題発覚時の即時ロールバック:
```bash
cp ~/midnight/gyotak-catch/tsconfig.json.bak-20260421-p2s1-AFTER ~/midnight/gyotak-catch/tsconfig.json
# ↑ このバックアップは Phase 2-Step 1 適用後の状態。完全ロールバックには Phase 2-Step 1 適用前の
# include 値 ["src/**/*.ts", "contracts/managed/contract/index.d.ts"] に戻す必要がある。
# 上記の diff を参照して手動で復元、または:
#   sed -i 's|, "scripts/\*\*/\*.ts"||' ~/midnight/gyotak-catch/tsconfig.json

cp ~/midnight/gyotak-catch/scripts/mirror-pending.ts.bak-20260421-p2s1 ~/midnight/gyotak-catch/scripts/mirror-pending.ts
```

### Next cron behavior (予測)
次回 10 分以内の cron 実行:
- `fetchPending` は従来通り 5 件の batch_id=null 行を除外 → 0 行返る
- 早期 exit path で `no pending rows; nothing to do` / `success=0 recovered=0 failed=0` → 現状維持

自己治癒が発動する条件:
- 原因 C の外部リセットが再発し、既存の failed 行が pending に戻される → 次の cron で pre-check が on-chain を検出 → `markAlreadyOnChain` で confirmed に戻る（再発防止が機能）
- 新規の catch_report が `batch_id` 付きで挿入された場合は従来通り `markSubmitting` → `submitCatchRecord` → `markConfirmed` フローが走る (regression なし)
