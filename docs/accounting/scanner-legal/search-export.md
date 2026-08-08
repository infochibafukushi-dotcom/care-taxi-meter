# 税務検索・一括出力

## 検索（クライアント側フィルタ）

ユーティリティ: `src/utils/accountingScannerSearchQuery.ts`

| フィルタ | 対象フィールド |
|---|---|
| 取引日範囲 | `transactionDate` |
| 受領日範囲 | `receivedDate` |
| 支払先 | `vendorNameCandidate`, `memo`, `id`, `confirmed.vendorName` |
| 金額範囲 | `amountTotalCandidate`, `confirmed.amount` |
| 法定状態 | `legalStatus` |
| 削除含む | `isDeleted` / `legalStatus=deleted` |

**対象:** `captureMode === scanner_v1` のみ。

## Firestore クエリ（本番）

大量データではサーバー側クエリ + 複合インデックスを使用。フィルタビルダーは UI と CSV 前処理で共通利用可能。

## CSV 一括出力

ユーティリティ: `src/utils/accountingScannerExport.ts`

- **UTF-8 BOM** 付き（Excel 互換）
- 必須列: `SCANNER_RECEIPT_EXPORT_CSV_HEADERS`（receiptId, 日付, vendor, amount, legalStatus, timestampStatus, fileHash, version 等）
- ファイル名: `scanner-receipts-YYYYMMDD.csv`

## ZIP 同梱インデックス

`buildScannerReceiptExportIndexJson` — master パス・tsr パス・fileHash の JSON マニフェスト。税理士提出パッケージ用。

## 監査

一括出力実行時は `accountingScannerAudit` で `exported` イベントを記録すること（UI 実装時）。

## 注意

- 論理削除済みはデフォルト除外。税務調査用に `includeDeleted: true` で含める
- `timestampStatus !== issued` の証憑は「正式保存未完了」として CSV 上も区別する
