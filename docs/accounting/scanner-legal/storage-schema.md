# Storage / Firestore スキーマ

## Storage パス

```
accounting/{franchiseeId}/{storeId}/receipts/{receiptId}/legal/v{version}/
  master.jpg      # 法定マスター（JPEG、SHA-256 = fileHash）
  thumb.webp      # 一覧用サムネ（webp または jpg）
  timestamp.tsr     # RFC3161 等トークン（issued 後）
```

ビルダー: `src/utils/accountingScannerPaths.ts`

## Firestore: accountingReceipts

主要フィールド（`AccountingReceiptLegalFields`）:

| フィールド | 説明 |
|---|---|
| `captureMode` | `scanner_v1` |
| `legalStatus` | 法定ワークフロー状態 |
| `timestampStatus` | TSA 状態 |
| `receivedDate` / `foundDate` | 受領日 / 発見日 |
| `transactionDate` | 取引日 |
| `fileHash` | master SHA-256 |
| `legalMasterStoragePath` | 現 active の master パス |
| `version` / `activeVersion` | 最新版番号 / 有効版番号 |
| `deadlineDueDate` | 入力期限（YYYY-MM-DD） |
| `requiresPaperOriginal` | 紙原本保管フラグ |
| `isDeleted` | 論理削除 |

## サブコレクション: versions/v{N}

版ごとのスナップショット（パス、hash、timestamp 情報、`isActive`）。

## 監査ログ

`auditLogs` に `accounting.scanner.*` アクション（`accountingScannerAudit.ts`）。

## インデックス

税務検索・一覧用の複合インデックスは `firestore.indexes.json` を参照。デプロイ後にインデックス作成完了を待つこと。
