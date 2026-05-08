# Preprod Migration — Day 1 Summary

Session date: **2026-05-05** (BKK timezone)
Goal: Add Preprod network support to gyotak-catch without disturbing Preview cron or Mainnet deploy attempts.

## 完了した作業

### コード変更

| 変更 | ファイル | 内容 |
|---|---|---|
| 追加 | `src/config.ts` | `PreprodConfig` クラス追加 (proofServer デフォルト = `https://proof-server.preprod.midnight.network`、indexer/RPC は preprod ドメイン、`setNetworkId('preprod')`) |
| 新規 | `src/preprod.ts` | preview.ts と完全パラレルの 7 行エントリ (`new PreprodConfig()` → `cli.run()`) |
| 編集 | `package.json` | scripts 4 本追加: `preprod` / `deploy:preprod` / `record-catch:preprod` / `verify-catch:preprod`、各々に `NODE_OPTIONS='--max-old-space-size=8192'` を prepend (Preprod sync の OOM 対策) |
| 編集 | `scripts/show-address.mjs` | `process.argv[2]` で network 引数対応 (デフォルト 'preview' で後方互換維持) |
| 編集 | `scripts/show-balance.mjs` | network 引数対応 + `InMemoryTransactionHistoryStorage` → `NoOpTransactionHistoryStorage` (SDK 3.0.0 アップグレード時の back-port 漏れ修正) |

すべての変更前ファイルは `*.bak-20260505-pre-preprod` (および package.json は `-oom` 別バックアップ) として保存済み。

### 環境的発見・確認

- **Preprod アドレス確認** (同 `.env` seed から派生):
  - Unshielded: `mn_addr_preprod156r935l92s4r6ze2k4nffn0k5en25jqprhg9x3xl3lm0ltkaam8q4py66s`
  - Shielded: `mn_shield-addr_preprod1c8yf4dmy47pshyznhx4gtp89grzsqkg89etx58pnwftwcms9gapaglvjjvtkcy49sj5kc65qx5vsrmsw7fqd6aealz3gkeg2kzqfqes2xkw2n`
  - Dust: `mn_dust_preprod1wd6rgfyh77awlww7rs2cufcun5uwpjvfcd2jhs3dqx2k42msxrlhzqa9l3l`
  - Bech32 HRP は `preprod` がそのまま使われる (Preview の `test`、Mainnet の無接尾辞とは明確に区別)

- **Faucet drip 成功**:
  - TX ID: `00d81f4f507f8201a0f8830a631f19cf9560baeb086c7bb2a7a1332999a1cd7211`
  - 受信: 1000 tNIGHT (= 1,000,000,000 specks)
  - wallet 観測確認済み: `show-balance.mjs preprod` 完走時に `NIGHT balance: 1,000,000,000 tNIGHT (1 coins, 0 registered for dust)` 出力
  - DUST はまだ 0 (NIGHT の dust generation 登録が未実施)

- **公式ドキュメント URL の typo 発見**:
  - 旧 (docs 記載): `https://lace-proof-pub.preprod.midnight.network` → **NXDOMAIN**
  - 正 (DNS 確認): `https://proof-server.preprod.midnight.network` → 3 IP に解決、HTTP/2 で応答
  - Preview/Mainnet も同命名規則 (`proof-server.preview.midnight.network` 生存、`proof-server.mainnet.midnight.network` は NXDOMAIN = Mainnet には公開 proof-server なし)

- **Preprod chain 健全性**:
  - chain_getHeader: block #647,155 (時点) で進行中、digest に BABE スロット情報あり
  - system_syncState: currentBlock = highestBlock = 647155 (full sync)
  - Indexer GraphQL Query type は `block / transactions / contractAction / dustGenerationStatus / dParameterHistory / SPO 系` 等が利用可能。HTTP Query には address ベースの unshielded UTXO 列挙 API は無く、wallet は Subscription/WebSocket 経路で UTXO を観測する設計

## 未完了

- **Preprod contract deploy**: `npm run deploy:preprod` (attempt 1) は sync 完了後に `Waiting for incoming tokens` (DUST > 0 待機) で停止。`.contract-address.preprod` は未生成。Faucet 後の状態でリトライ未実施
- **`record-catch:preprod` の動作確認**: deploy 未完のため未テスト
- **`verify-catch:preprod` の動作確認**: 同上
- **`scripts/mirror-pending.ts` の Preprod 切替**: 当面 PreviewConfig のまま (Preview cron 稼働継続のため意図的に未着手)

## 構造的問題 (明日対応)

- **Preprod wallet の sync が毎回 ~170 分**: 
  - 既存 LevelDB (`midnight-level-db/`) は Preview chain 専用 (mtime 2026-05-02 で更新中)
  - Preprod 用には永続化先がなく、wallet 起動のたびに full sync が必要
  - 反復テスト (balance → deploy → record → verify) が事実上不可能
  - `attempt 1` 実測: sync ~178 分 + Wallet Overview 出力後 `Waiting for incoming tokens` で hang
  - `show-balance.mjs preprod` 単独実行: ~170 分で `isSynced=true` 到達、balance 表示後正常終了

- **Mainnet 1016 問題は依然未解決**:
  - forum スレ #1190 (2026-04-29 投稿、2026-05-05 時点で 5 日経過) は **返信ゼロ**、views=8、participant=1
  - Plan A2 (root-pruning 仮説対応) も 3 回連続 1016 で失敗 (`docs/deploy-mainnet-attempt9.log` 参照)
  - Mainnet 公開 proof-server も無し (`proof-server.mainnet.midnight.network` NXDOMAIN) = Midnight 公式が Mainnet contract deploy をまだ実用提供していない可能性

## 明日の最初のタスク

1. **LevelDB 永続化を実装**:
   - 候補保存先: `~/midnight/gyotak-catch/midnight-level-db/preprod/` (既存 Preview と並列ディレクトリ構造)
   - or `~/.local/share/midnight-level-db/preprod/` (XDG 準拠、user-wide)
   - SDK 側の `levelPrivateStateProvider` 設定で DB パスを指定する経路があるはず → コード調査必要
   - `src/api.ts` の provider 構築箇所 (`configureProviders`) が起点
2. **その後 `npm run deploy:preprod` を再実行**:
   - LevelDB 永続化されていれば 2 回目以降の sync は数秒〜数分で済む見込み
   - DUST registration が自動で走り (`api.ts:registerForDustGeneration`)、ZK proof + submit へ進む
3. **deploy 成功確認後**:
   - `.contract-address.preprod` 生成確認
   - `record-catch:preprod` で 1 件記録、`verify-catch:preprod` で読み戻し確認
4. **mirror-pending.ts の Preprod 切替検討**:
   - PreviewConfig → PreprodConfig 切替 or 並列運用 (環境変数で網切替)
   - 切替時は cron line も併せて更新

## 関連ファイル

- `docs/deploy-preprod-attempt1.log` (~35,000 行、大部分が sync emission 診断ログ)
- `docs/RESUMPTION_GUIDE.md` (Mainnet deploy 用、引き続き有効)
- `docs/MAINNET_DEPLOY_1016_REPORT.md` / `MAINNET_DEPLOY_1016_FORUM_POST.md` (背景資料)
- `logs/preprod/` (今日の deploy attempt の pino 構造化ログ)
- `logs/mainnet/deploy-events-2026-05-05T05-34-49-048Z.log` (本日 attempt 9 の構造化イベントログ、参考)
