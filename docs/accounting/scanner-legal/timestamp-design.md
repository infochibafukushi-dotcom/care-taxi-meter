# タイムスタンプ設計

## 原則

1. **ダミータイムスタンプ禁止** — 未設定・検証失敗時に `issued` にしない
2. **Secrets はサーバーのみ** — クライアント（VITE_*）に置かない
3. **発行と検証の両方成功** が `legal_saved` への前提

## 環境変数（Cloud Functions）

| 変数 | 用途 |
|---|---|
| `ACCOUNTING_TIMESTAMP_PROVIDER` | 事業者識別子（例: `rfc3161`）。空 or `unconfigured` → 未設定 |
| `ACCOUNTING_TIMESTAMP_TSA_URL` | TSA エンドポイント URL |
| `ACCOUNTING_TIMESTAMP_API_KEY` | API キー / 認証情報 |

**3 つすべて有効値が揃わない限り** `UnconfiguredTimestampProvider` を使用。

## 未設定時の挙動

```
issue() → { ok: false, configured: false, code: TIMESTAMP_PROVIDER_NOT_CONFIGURED }
```

- Firestore: `timestampStatus: failed`（または pending から failed）
- `legalStatus`: **`legal_pending_timestamp` のまま**
- UI: `LEGAL_TIMESTAMP_UNCONFIGURED_LABELS` を表示
- 紙原本保管を案内

## 成功時のみ

```
issue ok + verify ok → timestampStatus: issued
                     → legalStatus: legal_saved_accounting_pending
                        （元が late_saved なら late_saved 維持）
```

## 実装参照

| ファイル | 役割 |
|---|---|
| `functions/src/accountingTimestampProvider.ts` | Provider 抽象・Unconfigured |
| `functions/src/issueAccountingReceiptTimestamp.ts` | Callable エンドポイント |
| `src/utils/accountingTimestampPolicy.ts` | クライアント側純粋判定 |
| `src/services/accountingReceiptTimestamp.ts` | クライアント呼び出し |

## クライアント表示ルール

- `isLegalPendingTimestamp(legalStatus)` → 正式保存未完了
- `isTimestampIssued(timestampStatus)` → 発行済み
- `requiresPaperOriginalRetention(...)` → 紙原本必要判定

## 将来拡張

`ACCOUNTING_TIMESTAMP_PROVIDER=rfc3161` 等で具体実装を差し替え。契約・接続確認後にのみ本番有効化。
