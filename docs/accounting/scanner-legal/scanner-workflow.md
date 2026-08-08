# スキャナ保存ワークフロー

## 法定ステータス遷移

```
draft
  → image_review
  → legal_pending_timestamp ──(TSA issued)──→ legal_saved_accounting_pending
  │                      └──(期限超過)──→ late_saved
  └──(キャンセル)──→ deleted

legal_saved_accounting_pending → accounting_confirmed → deleted（論理）
late_saved → deleted（論理）
```

## 各段階

| legalStatus | 意味 | 紙原本 |
|---|---|---|
| `draft` | 撮影セッション開始 | 保管 |
| `image_review` | 四隅・用紙サイズ・DPI 確認中 | 保管 |
| `legal_pending_timestamp` | master 確定、TSA 未発行 | **必須** |
| `legal_saved_accounting_pending` | TSA 発行・検証済、経理未確認 | 規程に従う |
| `accounting_confirmed` | 経費紐付・経理確認済 | 規程に従う |
| `late_saved` | 入力期限超過後の保存 | **必須** |
| `deleted` | 論理削除（issued 後） | 規程に従う |

## 入力期限（rapid モード）

- 受領日の **翌営業日** から **7 営業日**（土日・休業日除く）
- 超過 → `late_saved` + `requiresPaperOriginal: true`
- 受領日不明 → 期限算出不可、紙原本必須

## タイムスタンプ発行

1. ユーザーまたはバッチが `issueAccountingReceiptTimestamp` を呼ぶ
2. 未設定 TSA → `failed`、`legalStatus` は `legal_pending_timestamp` 維持
3. 発行+検証成功 → `issued`、`legal_saved_accounting_pending`（または `late_saved` 維持）

## 再撮影（版管理）

- 同一 `receiptId` に `v2`, `v3` … を追加
- 新版の TSA 発行完了まで **activeVersion は旧版のまま**
- 発行成功後 `activateScannerReceiptVersion` で active 切替

## 削除

| 条件 | 方式 |
|---|---|
| `timestampStatus !== issued` | **完全削除**（Storage 含む） |
| `timestampStatus === issued` | **論理削除**のみ |
