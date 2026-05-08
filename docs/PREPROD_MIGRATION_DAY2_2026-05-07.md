# Preprod Migration — Day 2 Summary

Session date: **2026-05-07** (BKK timezone)
Goal: Day 1 から繰り越した「Preprod wallet sync が毎回 ~170 分」の構造的問題を解決し、`deploy:preprod` / `record-catch:preprod` / `verify-catch:preprod` の三点セットを完走させる。

## 完了した作業

### コード変更

| 変更 | ファイル | 内容 |
|---|---|---|
| 編集 | `src/config.ts` | `Config` interface に optional `walletStateDir?: string` を追加。`PreprodConfig` だけ `walletStateDir = midnight-level-db/preprod` を設定 (Preview/Mainnet/Standalone は未設定 = 従来動作維持) |
| 編集 | `src/api.ts` | wallet sync state 永続化を実装。`tryReadWalletState()` / `saveWalletStates()` ヘルパー追加 (後者は export)。`buildWalletAndWaitForFunds` 内で 3 ファイル全揃いなら `restore()`、欠ければ `startWith*()`。sync 完了直後に save。さらに `if (dustCoins===0) waitForFunds(...)` の **deadlock 経路を削除** — `registerForDustGeneration()` が NIGHT 登録 + DUST 待機を全て担当するように改修 |
| 編集 | `src/cli.ts` | 全 3 cmd (`cmdDeploy` / `cmdRecordCatch` / `cmdVerifyCatch`) の `finally` で `wallet.stop()` 直前に `api.saveWalletStates(walletCtx.wallet, config.walletStateDir)` を呼ぶように追加 (no-op when not configured) |
| 編集 | `package.json` | `preprod` script に `PATH=/home/takuya/.local/node22/bin:$PATH` を前置。Node 22+ で追加された `Set.prototype.difference` を SDK の restore 経路 (`wallet-sdk-shielded`) が要求するため、Node 20 だと TypeError で死ぬ |

すべての変更前ファイルは `*.bak-20260507-pre-walletpersist` または `*.bak-20260507-pre-waitforfunds-fix` として保存済み。

### デバッグ過程で発見した問題と修正

| 番号 | 症状 | 原因 | 修正 |
|---|---|---|---|
| 1 | attempt 2: sync 完了後 `Waiting for incoming tokens` で 2h35m 立ち往生 | `api.ts:474` の `waitForFunds` が `dust.balance>0` を要求するが、その後で呼ばれる `registerForDustGeneration` が初めて NIGHT を登録するため永久 deadlock。Preview/Mainnet では既存 wallet なので露呈せず、Preprod の fresh wallet で初めて顕在化 | `waitForFunds` 経路を削除し、`registerForDustGeneration` に NIGHT 登録 + DUST 待機を集約 |
| 2 | attempt 3: `restore` 経路を起動したが `TypeError: coinNonces.difference is not a function` で即死 | Node 20.20.2 (`/usr/bin/node`) には `Set.prototype.difference` が未実装。Node 22+ で追加された機能を SDK が利用 | `package.json` の `preprod` script に `PATH=/home/takuya/.local/node22/bin:$PATH` を前置 (cron は元から Node 22 を直指定なので無問題、deploy/record/verify 経路だけ Node 20 を引いていた) |

### 計測結果 — 永続化の効果

| 段階 | sync 時間 | emissions | 比率 |
|---|---|---|---|
| attempt 2 (cold start, 永続化なし) | **10,569.0 秒** (176.2 分) | 35,913 | 1.0x |
| attempt 4 (restore from saved) | **13.0 秒** | 99 | **813x 高速化** |
| record-catch attempt 1 (restore) | 1.5 秒 | 9 | ~7,000x |
| verify-catch attempt 1 (restore) | 1.4 秒 | 8 | ~7,500x |

cold sync の所要時間は chain 履歴量に比例するので、永続化が無いと反復テストが事実上不可能だったのが、永続化導入で **数秒で wallet 起動可能** に改善。

### End-to-End 動作確認

| コマンド | 結果 | 重要な値 |
|---|---|---|
| `deploy:preprod` (attempt 4) | ✅ 約 2 分 35 秒で完走、exit 0 | Contract address: `a3f3a04476914b86eb914a4e3626519b1538395901fd376442a1fa8afffe836f` |
| `record-catch:preprod` (attempt 1) | ✅ 約 1 分で完走、exit 0 | TX: `007ae1af1bccd6aa3f2aaba84f9ac7082a0273ea3b276fc2502eba917ee901fc44`, block 676,429, blockHash `40e7e16450ec106fa58a0e03d173ce89f8333a9d3dabdd0a55720771ba622643` |
| `verify-catch:preprod` (attempt 1) | ✅ 約 22 秒で完走、exit 0 | 全 7 フィールド (batchId / region / catchDate / fishSpecies / photoHash / gpsHash / committedAt) が record-catch 投入値と完全一致 |

### テストデータ (record-catch)
- batchId: `PREPROD-TEST-20260507-01` (textToBytes32 で 32-byte zero-padded)
- region: `Bangkok`
- catchDate: `2026-05-07`
- fishSpecies: `Test Mackerel`
- photoUrl: `https://placehold.co/200x200.png` → 2,220 bytes → SHA-256 `e96616c15e7a63a4d21bd46dc64a2b358f26577b994b24b4362a84460e352955`
- gps: `13.7563, 100.5018` (バンコク)、witness で `gpsHash = af5570f5a1810b7af78caf4bc70a660f0df51e42baf91d4de5b2328de0e83dfc` に変換 (プレイン GPS は on-chain に出ない、ZK 設計通り)
- committedAt: `1778153795` (2026-05-07T11:36:35.000Z UTC)

### 永続化ファイル状態 (deploy + record + verify 後)

```
midnight-level-db/preprod/
├─ dust.json        3.0 MB (3,184,560 → 3,184,560 bytes、record-catch 後の DUST 引当て反映済み)
├─ shielded.json    3.7 KB
└─ unshielded.json  736 B (NIGHT 1 UTXO は registered 状態を保持)
```

DUST 残高推移:
- deploy 完了直後: ~1,449 DUST (NIGHT registration 直後)
- record-catch 起動時: 1,449,384,585,999,999,998 specks
- verify-catch 起動時 (~1 分後): 1,450,241,965,999,999,997 specks → **+857 DUST/分** で継続増加

## 構造的問題の更新

### Mainnet 1016 問題 — 依然未解決、ただし示唆が増えた

- forum #1190 (2026-04-29 投稿) は 5/7 時点でも **返信ゼロ**
- **Preprod では 1016 が一切発生しなかった** (deploy / register-night / record-catch すべて 1 発成功)
- 同じ wallet-sdk-capabilities/3.3.0、同じ ZK proof 経路、同じ Substrate `submitAndWatchExtrinsic` 経路にも関わらず Preprod では問題なし
- → **Mainnet 1016 は Mainnet ノード固有の問題**である可能性が強く示唆された (forum 仮説 #2「load balancer that masks per-node pool issue」と整合)
- 公式 Mainnet proof-server も `proof-server.mainnet.midnight.network` は NXDOMAIN → Mainnet contract deploy はそもそも公式提供フェーズ外の可能性

→ 次のアクション候補: forum #1190 に追加情報投稿 (「Preprod では同じ seed/SDK で 1 発成功した」事実は 1016 が Mainnet ノード/ロードバランサ側の問題である決定的な傍証)

### 安全弁 — Preview cron は無傷で稼働継続

```
crontab -l:
*/10 * * * * cd /home/takuya/midnight/gyotak-catch && node22 ... scripts/mirror-pending.ts ...
```

- mirror-pending.ts は依然 `PreviewConfig` をハードコード使用 (意図的、Preview cron 影響回避)
- 既存 `.contract-address.preview` (`86d822...`) も無傷
- 既存 `midnight-level-db/` (Preview の levelPrivateStateProvider 用) も独立して稼働

## 未完了

- **`scripts/mirror-pending.ts` の Preprod 切替**: 当面 PreviewConfig のまま。切替時の選択肢:
  - (a) 単純切替: import を `PreprodConfig` に変更 → Preview cron 停止、Preprod cron に置換
  - (b) 並列運用: 別スクリプト `mirror-pending-preprod.ts` を作成 → cron に行追加
  - (c) network env-aware: `NETWORK` 環境変数で網切替する書き換え
- **Preview 側の archive 判断**: Preprod 移行が成功した今、Preview の `.contract-address.preview` (`86d822...`) と Preview cron をいつ停止するかは別判断 (要 Takuya 判断、ビジネス側との整合)

## 関連ファイル

- `src/config.ts.bak-20260507-pre-walletpersist` (永続化追加前)
- `src/api.ts.bak-20260507-pre-walletpersist` (永続化追加前)
- `src/api.ts.bak-20260507-pre-waitforfunds-fix` (deadlock 修正前)
- `src/cli.ts.bak-20260507-pre-walletpersist` (finally save 追加前)
- `docs/deploy-preprod-attempt2.log` (cold sync 176 分 + deadlock の証拠ログ)
- `docs/deploy-preprod-attempt3.log` (Node 20 TypeError の証拠ログ、14 行のみ)
- `docs/deploy-preprod-attempt4.log` (✅ 成功ログ、約 2 分 35 秒)
- `docs/record-catch-preprod-attempt1.log` (✅ 記録 TX 成功ログ)
- `docs/verify-catch-preprod-attempt1.log` (✅ 読み戻し成功ログ)
- `midnight-level-db/preprod/{shielded,unshielded,dust}.json` (永続化された wallet state、合計 ~3.0 MB)

## 明日以降のタスク候補 (優先順)

1. **forum #1190 に Preprod 動作確認結果を投稿** — Mainnet 1016 が Mainnet 固有問題である決定的傍証として
2. **mirror-pending.ts の Preprod 切替方針決定** — Preview 並走 / 切替 / env-aware のいずれか
3. (将来) Preview archive と完全 Preprod 移行 — Day 1 の `.env` (Preview seed) を Preprod でも流用しているので、cron 切替が完了すれば Preview 関連リソースを段階的に廃止可能
4. (将来) Mainnet deploy の再開 — 公式 Mainnet proof-server が公開され、1016 問題が forum 経由で解決された時点で
