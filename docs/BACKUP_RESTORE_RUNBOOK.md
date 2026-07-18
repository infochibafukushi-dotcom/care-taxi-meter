# バックアップ復元ランブック（Backup / Restore Runbook）

基準コミット: `909b60e9d97e8f56cad044e2bc6ee07f1e1b287e`（main）

本ドキュメントは **読み取り確認と手順整備** のためのランブックです。  
**本番復元は実行しません。** 復元作業を行う場合も、必ず事前バックアップ・対象件数確認・承認を経たうえで、別途手動実施します。

関連:

- ポリシー定数: `src/utils/backupRestoreRunbookPolicy.ts`
- dry-run（書き込み禁止）: `npm run backup:restore:dry-run`
- 週次バックアップ方針: `src/utils/lightweightBackupPolicy.ts`
- Auth V2 バックアップ: `npm run auth:v2:backup` / `auth:v2:backup:rest`

---

## 0. 絶対ルール

1. **本番復元コマンドをこのリポジトリのスクリプトから実行しない**（dry-run 専用）。
2. **本番データを dry-run で変更しない**。
3. 復元には必ず次を満たすこと:
   - 事前バックアップ（または利用可能なバックアップの存在確認）
   - 対象件数・金額の確認
   - 承認者の明示的承認（氏名・日時・チケット）
4. **画像・PDF はバックアップに複製されていない**。
5. **削除済み Storage オブジェクトは復元不可**。
6. **Auth 平文パスワードは復元不可**。復旧はパスワード再設定で対応する。
7. 経理ガード値 **有効経費 26件 / 税込合計 136,578円** を意図せず変更しない。

---

## 1. バックアップ対象と現状

### 1.1 Firestore 週次バックアップ

| 項目 | 値 |
| --- | --- |
| GCS バケット | `care-taxi-meter-fs-backup-ane1` |
| スケジュール | Cron `30 3 * * 0` = **毎週日曜 03:30 JST**（`Asia/Tokyo`） |
| 保持期間 | **30日**（`LIGHTWEIGHT_BACKUP_RETENTION_DAYS` + GCS lifecycle） |
| 出力先 | `gs://care-taxi-meter-fs-backup-ane1/daily/{YYYY-MM-DD}` |
| 実装 | Cloud Function `runLightweightFirestoreBackup` |
| 状態ドキュメント | `lightweightBackupStatus/latest` |
| Lifecycle 定義 | `scripts/firestore-backup-lifecycle.json` |

**含まれる（allowlist）:**  
`accountingExpenses`, `accountingAdjustments`, `accountingFixedCosts`, `accountingSales`, `accountingExports`, `accountingFixedAssets`, `accountingSettlementAuxiliary`, `caseRecords`, `workSessions`, `staffAttendance`, `companies`, `stores`, `vehicles`, `meterSettings`, `hqSettings`, `fcPlans`, `appSettings`, `preOpeningResetState`

**含まれない（denylist / 別系統）:**  
`auditLogs`, `loginAttempts`, `debugLogs`, `staffMembers`, `staffCredentials`, `accountingReceipts`、および **Firebase Storage 上の画像/PDF**

> 重要: 週次バックアップは **文字データ（Firestore ドキュメント）中心**です。  
> **画像はバックアップ複製されていません。**

### 1.2 D1 Time Travel（予約）

| 項目 | 値 |
| --- | --- |
| 所有者 | **reservation-v4**（本リポジトリ外） |
| Worker | `throbbing-bush-8f59` |
| Origin | `https://throbbing-bush-8f59.info-chibafukushi.workers.dev` |
| 本リポジトリの D1 バインディング | **なし**（driver-proxy は Service Binding のみ） |
| 関連データ例 | `meter_fixed_fare_runs`（`08_本番運用仕様.md` §15.5） |

#### D1 Time Travel 利用方法（概要・手動）

reservation-v4 側プロジェクトで実施します（**本 dry-run では実行しない**）。

```bash
# 1) 利用可能な bookmark / 保持状況を確認（読み取り）
npx wrangler d1 time-travel info <DATABASE_NAME>

# 2) 復元ポイントを選定（bookmark または timestamp）
# 3) 承認後のみ restore（本番書き込み）
npx wrangler d1 time-travel restore <DATABASE_NAME> --bookmark=<BOOKMARK>
# または
npx wrangler d1 time-travel restore <DATABASE_NAME> --timestamp=<ISO8601>
```

Time Travel の保持ウィンドウは Cloudflare / アカウント設定に依存します。期限外は復元できません。

### 1.3 Auth V2 バックアップ

| 項目 | 値 |
| --- | --- |
| 出力先 | `.auth-v2-backup/<stamp>/`（gitignore） |
| 取得 | `npm run auth:v2:backup` または `auth:v2:backup:rest` |
| ファイル | `staffMembers.json`, `companies.json`, `staffCredentials.json`, `firebaseAuthUsers.json`, `manifest.json` |
| パスワード | **`[redacted-present]`**。平文は保存・復元しない |
| スクリプトの復元 | **しない**（バックアップのみ） |

#### staffCredentials / Firebase Auth 復旧手順（手動・承認後）

1. 最新の `.auth-v2-backup/<stamp>/manifest.json` で件数を確認する。
2. `staffCredentials.json` と `firebaseAuthUsers.json` で uid・claims・disabled を照合する（パスワード値は出ない）。
3. Firebase Auth ユーザーが欠落している場合は Auth ユーザーを再作成する。
4. **パスワードは再設定**する（Admin UI / `upsertStaffCredential`）。  
   **平文パスワードのバックアップ復元は不可。**
5. `syncStaffAuthClaims` 等で claims を再同期する。
6. 代表アカウントでログイン確認する。

週次 Firestore バックアップには `staffMembers` / `staffCredentials` は含まれません。Auth 復旧は Auth V2 バックアップ + パスワード再設定が主経路です。

### 1.4 証憑 Storage

| 項目 | 値 |
| --- | --- |
| 場所 | Firebase Storage `accounting/{franchiseeId}/{storeId}/receipts/...` |
| 週次バックアップ | **複製しない** |
| `accountingReceipts` | 週次 allowlist **外** |
| 削除済みオブジェクト | **復元不可** |

表示障害時は「メタデータ/権限/URL」と「オブジェクト欠落」を切り分けます。欠落は再アップロード以外に復旧手段がありません。

### 1.5 経理データ

| 項目 | 値 |
| --- | --- |
| 主コレクション | `accountingExpenses` 他 accounting*（receipts 除く） |
| 週次バックアップ | allowlist 対象（receipts / 画像除く） |
| 整合ガード | **有効 26件 / 税込合計 136,578円**（意図的変更がない限り維持） |

---

## 2. 復元前確認チェックリスト

作業開始前にすべて確認し、チケットにチェック結果を残す。

- [ ] 基準コミット `909b60e9d97e8f56cad044e2bc6ee07f1e1b287e` を確認した
- [ ] 障害種別と影響範囲（Firestore / D1 / Auth / Storage）を特定した
- [ ] 本番復元を実行しない方針を共有した（または承認済み本番作業であること）
- [ ] 事前バックアップを取得、または利用可能なバックアップ URI / ディレクトリを記録した
- [ ] 対象件数を確認した（経理: 有効経費件数・税込合計）
- [ ] 経理ガード値（26件 / 136,578円）を変更しないことを確認した
- [ ] 画像/PDF はバックアップに複製されていないことを関係者が理解した
- [ ] 削除済み Storage オブジェクトは復元不可であることを関係者が理解した
- [ ] Auth 平文パスワードは復元不可（再設定が必要）であることを理解した
- [ ] 承認者・作業者・監視者を決め、作業開始時刻を記録した
- [ ] `npm run backup:restore:dry-run` を実行し、FAIL がないことを確認した

必須ゲート（いずれの障害でも）:

1. 事前バックアップ取得（または既存バックアップの存在確認）
2. 対象件数・金額の確認（変更前後の差分を記録）
3. 承認者の明示的承認（氏名・日時・チケット/チャットURL）
4. 本番書き込みは dry-run 完了後に別作業として実施

---

## 3. 復元後確認チェックリスト

- [ ] 対象データの件数が想定どおりである
- [ ] 経理: 有効経費が **26件・税込合計 136,578円** のまま（意図的変更がない限り）
- [ ] スタッフログイン（Auth V2）が代表アカウントで成功する
- [ ] 予約画面（reservation-v4 / D1）の主要一覧が開ける
- [ ] 証憑画像: 既存オブジェクトの表示のみ確認（削除済みは復元不可）
- [ ] Firestore 復元後は `lightweightBackupStatus/latest` の最終成功時刻を確認した
- [ ] 作業ログ（対象・件数・承認・結果）をチケットに残した
- [ ] 追加の破壊的操作（再削除・再 import）を行っていない

---

## 4. dry-run 専用確認スクリプト

```bash
# ローカル方針・チェックリスト・障害別手順の確認のみ（書き込みなし）
npm run backup:restore:dry-run

# 任意: Firestore 経費件数の読み取り確認（書き込みなし）
# GOOGLE_OAUTH_ACCESS_TOKEN が必要。復元はしない。
GOOGLE_OAUTH_ACCESS_TOKEN=... npm run backup:restore:dry-run -- --with-live-read
```

制約:

- `DRY_RUN=false` の場合は **即終了**（本番適用モード禁止）
- Firestore import / D1 restore / Auth 書き込みは **実行しない**
- パスワード値は出力しない
- 経理 26件 / 136,578円を変更しない

単体テスト:

```bash
npx vitest run src/utils/backupRestoreRunbookPolicy.test.ts
```

---

## 5. 障害別の復元方法

いずれも **承認後の手動作業**。下記コマンド例は手順書であり、本リポジトリの dry-run からは起動しません。

### 5.1 経費1件を誤削除

**想定:** `accountingExpenses` の論理削除（`isDeleted` / `deletedAt`）。

| 項目 | 内容 |
| --- | --- |
| 主ソース | Firestore `accountingExpenses` |
| バックアップ自動復元 | 通常不要（ドキュメント単位の論理復旧） |
| 手順 | 1. 対象 ID・削除前後件数を記録 2. 事前バックアップ/エクスポート確認 3. 承認 4. `isDeleted=false` と削除メタデータ解除（手動） 5. 紐付固定資産があれば同様に確認 6. 件数・金額再集計 |
| 注意 | 紐付証憑画像が Storage から削除済みなら **画像は復元不可** |

### 5.2 Firestore 全体の破損

| 項目 | 内容 |
| --- | --- |
| 主ソース | `gs://care-taxi-meter-fs-backup-ane1/daily/{YYYY-MM-DD}` |
| 保持 | 30日。期限切れは利用不可 |
| 手順 | 1. `lightweightBackupStatus/latest` と GCS オブジェクト一覧で復元ポイント選定 2. 事前に現状の追加エクスポート（可能なら） 3. 対象コレクション件数を記録 4. 承認 5. `gcloud firestore import gs://care-taxi-meter-fs-backup-ane1/daily/YYYY-MM-DD --async`（プロジェクト/DB 指定は運用手順に従う） 6. 復元後チェックリスト実施 |
| 注意 | allowlist 外（Auth 資格情報・`accountingReceipts`・ログ）と **画像は戻らない** |

### 5.3 予約 D1 の破損

| 項目 | 内容 |
| --- | --- |
| 主ソース | Cloudflare D1 Time Travel（reservation-v4） |
| 手順 | 1. reservation-v4 側で `wrangler d1 time-travel info` 2. bookmark/timestamp 選定 3. Firestore `caseRecords` との不整合リスクを記録 4. 承認 5. `wrangler d1 time-travel restore ...` 6. 予約一覧・固定運賃運行状態を確認 |
| 注意 | 本リポジトリに D1 設定はない。driver-proxy 経由の API 疎通確認のみ可能 |

### 5.4 スタッフ認証の破損

| 項目 | 内容 |
| --- | --- |
| 主ソース | `.auth-v2-backup/<stamp>/` |
| 手順 | セクション 1.3 の復旧手順に従う |
| 注意 | **平文パスワードは復元不可**。必ずパスワード再設定。週次バックアップにも資格情報は含まれない |

### 5.5 証憑画像の表示障害

| 項目 | 内容 |
| --- | --- |
| 主ソース | Storage `accounting/...` +（参照用）`accountingReceipts` |
| 手順 | 1. オブジェクト存在確認 2. ルール / 署名付き URL / アプリ経路確認 3. メタデータ不整合なら参照修正（承認後） 4. オブジェクト欠落なら再アップロード |
| 注意 | **画像はバックアップ複製されていない。削除済み画像は復元不可** |

---

## 6. 承認・記録テンプレート

```text
日時:
作業者:
承認者:
障害種別: （経費誤削除 / Firestore破損 / D1破損 / Auth破損 / 証憑表示）
事前バックアップ:
  - Firestore URI / 有無:
  - Auth V2 stamp:
  - D1 bookmark/timestamp:
対象件数（前）:
対象件数（後・予定）:
経理ガード確認: 26件 / 136,578円 （変更しない / 意図的変更の理由）
画像復元可否の説明済み: Yes
平文パスワード復元不可の説明済み: Yes
dry-run 結果: OK / NG
本番書き込み実施: No（原則） / Yes（承認済み・別記録）
結果:
```

---

## 7. 確認事項（本整備での検証ポイント）

| 確認項目 | 結果 |
| --- | --- |
| Firestore バケット名 | `care-taxi-meter-fs-backup-ane1` |
| 頻度 | 週1回（日曜 03:30 JST） |
| 保持 | 30日 |
| D1 Time Travel | reservation-v4 側で `wrangler d1 time-travel info/restore`（本 repo では dry-run 文書化のみ） |
| Auth V2 | `staffCredentials` + Firebase Auth は `.auth-v2-backup` を材料に手動復旧。パスワードは再設定 |
| 経理 | **26件 / 136,578円を変更しない** |

---

## 8. 参照実装

- `functions/src/lightweightFirestoreBackup.ts`
- `src/utils/lightweightBackupPolicy.ts`
- `scripts/backupAuthV2PreMigration.ts`
- `scripts/backupAuthV2PreMigrationRest.mjs`
- `scripts/backupRestoreDryRun.ts`
- `src/utils/backupRestoreRunbookPolicy.ts`
- `workers/driver-proxy/wrangler.toml`（D1 なし / reservation-v4 Service Binding）
