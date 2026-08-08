# 版管理・削除ポリシー

## 版（version）

- 初回保存は `v1`。再撮影で `v2` 以降を **追加**（上書きしない）
- 各版は独立した Storage オブジェクト + `versions/vN` ドキュメント
- **activeVersion**: 税務上有効な版。新版 TSA 成功まで旧版が active
- **pendingVersion**: 作業中の新版（未 issued）

## 改ざん防止

- `timestampStatus === issued` 後は master の **上書き禁止**
- `assertMasterImmutable` / `verifyStoredMasterHash` で hash 照合

## 削除種別

### 完全削除（hard delete）

**条件:** `canHardDeleteScannerReceipt` = true（issued 前）

- Storage: master / thumb / tsr / 旧 OCR 画像を削除
- Firestore: ドキュメント + 全 `versions` 削除
- 監査: `hard_deleted_pre_timestamp`

**理由コード:** `ScannerDeleteReason`（誤登録・重複・撮影失敗 等）

### 論理削除（soft delete）

**条件:** `timestampStatus === issued`（または経理確認済）

- `legalStatus → deleted`, `isDeleted: true`
- Storage は保持（法定保存・監査のため）
- 監査: `deleted`

## 削除理由の記録

`deleteReason` + 監査ログ `reason` に保存。税務説明用に必須。

## UI 上の注意

- issued 後に「削除」を選んでもファイルは残る（論理削除のみ）
- 完全削除は確認ダイアログ + 理由選択を必須とする
