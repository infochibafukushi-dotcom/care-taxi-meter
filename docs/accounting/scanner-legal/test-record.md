# スキャナ保存 テスト記録テンプレート

## 実行情報

| 項目 | 内容 |
|---|---|
| テスト日 | YYYY-MM-DD |
| 実施者 | |
| 環境 | dev / staging / prod-readonly |
| アプリ版 | git commit / tag |
| TSA 設定 | 未設定 / 設定済 |

## 自動テスト（vitest）

```bash
npm test -- src/utils/accountingScannerDeadline.test.ts
npm test -- src/utils/receiptLegalStatus.test.ts
npm test -- src/utils/accountingTimestampPolicy.test.ts
npm test -- src/utils/accountingScannerPaths.test.ts
npm test -- src/utils/accountingScannerSearchQuery.test.ts
npm test -- src/utils/accountingScannerExport.test.ts
```

| スイート | 結果 | 備考 |
|---|---|---|
| accountingScannerDeadline | PASS / FAIL | |
| receiptLegalStatus | PASS / FAIL | |
| accountingTimestampPolicy | PASS / FAIL | |
| accountingScannerPaths | PASS / FAIL | |
| accountingScannerSearchQuery | PASS / FAIL | |
| accountingScannerExport | PASS / FAIL | |

## 手動シナリオ

| # | シナリオ | 期待結果 | 結果 | 備考 |
|---|---|---|---|---|
| 1 | 受領日あり・期限内撮影 | legal_pending_timestamp | | |
| 2 | 期限超過撮影 | late_saved, requiresPaperOriginal | | |
| 3 | 受領日不明 | 紙原本必須、dueDate null | | |
| 4 | TSA 未設定で発行 | failed、issued にならない | | |
| 5 | 経理紐付 | accounting_confirmed | | |
| 6 | issued 前削除 | Storage 消去 | | |
| 7 | issued 後削除 | 論理削除のみ | | |
| 8 | 再撮影 v2 | active は v1 維持 → issued 後 v2 | | |
| 9 | CSV 出力 | BOM + 必須列 | | |
| 10 | 税務検索フィルタ | 条件一致のみ | | |

## 不具合・残課題

| ID | 内容 | 重要度 | チケット |
|---|---|---|---|
| | | | |

## サインオフ

| 役割 | 氏名 | 日付 |
|---|---|---|
| 実装 | | |
| 経理確認 | | |
