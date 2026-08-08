# スキャナ保存（電子帳簿保存法）— システム概要

## 目的

領収書等を **スキャナ保存** 要件（画質・タイムスタンプ・改ざん検知）に沿って保存し、経理確認・税務調査対応まで追跡可能にする。

## 主要コンポーネント

| 層 | 役割 |
|---|---|
| フロント（`AccountingPage` / スキャナフロー） | 撮影・四隅補正・画質確認・正式保存トリガ |
| `accountingReceiptLegalSave` | master/thumb アップロード、Firestore 更新 |
| `issueAccountingReceiptTimestamp`（Cloud Functions） | 認定 TSA への発行・検証（サーバーのみ） |
| Storage | `master.jpg` / `thumb.webp` / `timestamp.tsr` |
| Firestore | `accountingReceipts` + サブコレクション `versions` |
| 監査 | `accountingScannerAudit` → `auditLogs` |

## 状態軸（2本）

1. **legalStatus** — 業務フロー（draft → … → accounting_confirmed / deleted）
2. **timestampStatus** — TSA 発行状態（none / pending / issued / failed）

**重要:** `timestampStatus !== issued` の間は「正式スキャナ保存完了」と表示・扱いしない。未設定 TSA では常に `legal_pending_timestamp` のまま。

## captureMode

- `legacy` — 従来アップロード（法定スキャナ保存対象外）
- `scanner_v1` — 本機能対象

## 関連ドキュメント

- [scanner-workflow.md](./scanner-workflow.md)
- [storage-schema.md](./storage-schema.md)
- [timestamp-design.md](./timestamp-design.md)
