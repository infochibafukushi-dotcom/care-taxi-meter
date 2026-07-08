# 経理アプリ 現状機能・仕様・課題レポート

調査日: 2026-07-09  
対象: `/accounting`（`AccountingPage.tsx` 中心）  
調査方法: ソースコード・Firestore rules/indexes・Storage rules の静的解析（実装変更なし）

---

## 1. 概要

経理アプリは **管理会計PL** を中心に、**経費登録（OCR付き）・未整理領収書・固定費マスタ・固定資産台帳・監査資料出力** を1画面（`/accounting`）に集約したモジュールです。

- **アクセス権限（UI）**: `owner` / `hq_admin` のみ（`canAccessAccounting`）
- **データ基盤**: Firestore（経費・領収書・固定費・固定資産等）+ Firebase Storage（領収書画像）
- **売上データ**: メーターアプリの `caseRecords`（確定案件）を **読取専用** で参照。`caseRecords` は変更しない設計
- **PL集計**: クライアント側で全件取得後に `accountingPl.ts` で月次/年次を計算
- **完成度**: 経費OCR〜PL〜CSV出力の主経路は実用レベル。売上調整UIのメニュー非表示・監査PDFの簡素さ・権限/UIギャップなど改善余地あり

### アーキテクチャ概要

```
caseRecords（確定売上・読取専用）
    ↓
accountingPl.ts ← accountingExpenses（確認済み経費）
                ← accountingAdjustments（調整行）
                ← accountingFixedCosts（固定費マスタ）
                ← accountingFixedAssets（減価償却費）
    ↓
月次PL / 年次PL / CSV / PDF（サマリー）

経費登録フロー:
  領収書撮影 → Storage + accountingReceipts(draft)
  → OCR(ocr_ready) → 経費フォーム → accountingExpenses(確認済み)
  → （任意）accountingFixedAssets（少額/固定資産）
```

---

## 2. 現状機能一覧

| 機能名 | 画面/コンポーネント | できること | 保存先 | PL反映 | CSV/PDF | 完成度 | 課題 |
|--------|---------------------|-----------|--------|--------|---------|--------|------|
| 経費登録 | `AccountingPage` 経費タブ | 領収書OCR・手入力・科目選択・資産分岐・確定保存 | `accountingExpenses` + `accountingReceipts` | ○（`plTreatment=expense`） | 経費CSV | **高** | 固定資産を通常経費で登録すると二重計上リスク |
| 領収書撮影・画像保存 | 経費タブ OCRフロー | カメラ/画像選択→Storageアップロード | Storage + `accountingReceipts` | × | 監査CSV（未整理のみ） | **高** | driverロールはStorage書込不可 |
| OCR読取 | `accountingReceiptOcr.ts` | Tesseract.js（jpn+eng）で候補抽出 | `accountingReceipts`（候補フィールド） | × | × | **中〜高** | 精度は参考値、最終科目は人手 |
| 未整理の領収書 | `UnorganizedReceiptsPanel` | 一覧・編集・OCR・確定・削除 | `accountingReceipts` | × | 監査CSV | **高** | 確定済み領収書は一覧に出ない |
| 固定費管理 | `FixedCostManagementPanel` | 月額/年額マスタCRUD・解約 | `accountingFixedCosts` | ○（固定費科目） | × | **高** | 会計年度(4月)プレビューとPL(暦年)の基準差 |
| 固定資産台帳 | `FixedAssetLedgerPanel` | 一覧・検索・ソート・編集・論理削除 | `accountingFixedAssets` | ○（減価償却費） | 監査CSV | **中〜高** | 新規登録は経費経由のみ。除却(disposed)未実装 |
| 少額資産管理 | `ExpenseAssetBranchPanel` | 経費登録時分岐・年間枠表示 | `accountingFixedAssets`（`assetKind=small`） | ○（取得月に経費全額） | 監査CSV | **中** | 一括償却の税務注記なし。台帳は固定資産画面に混在しない |
| 月次PL | `MonthlyManagementPlSections` | 売上/原価/固定費/変動費/粗利益/営業利益 | （集計のみ） | — | 月次PL CSV/PDF | **高** | 税込ベース。繰延候補は別枠 |
| 年次PL | 年次PLテーブル | 前々期/前期/月別/年間合計 | （集計のみ） | — | 年次PL CSV/PDF | **高** | カレンダー年基準 |
| 監査資料 | `AuditMaterialsPanel` | 多種CSV + PLサマリーPDF | （出力のみ） | — | ○ | **中** | PDFは数行サマリーのみ。export履歴UIなし |
| CSV・PDF出力 | Exportタブ | 月次/年次PL・売上・経費CSV | `accountingExports`（履歴） | — | ○ | **中** | 年次PL exportType 記録バグ |
| 確定売上・調整 | `sales` タブ（非表示） | 案件別売上参照・調整行追加 | `accountingAdjustments` | ○ | 売上CSV | **低（到達困難）** | メニューに未掲載 |
| 二重計上チェック | `DuplicateExpensePromptDialog` | 日付/金額/ベンダー/画像ハッシュ | — | — | × | **中** | 警告のみ、強制ブロックなし |

---

## 3. データ保存先一覧

### 3.1 Firestore コレクション

| コレクション | 用途 | 主な保存項目 | 作成/更新タイミング | 読取画面 | PL反映 | CSV出力 | 削除/論理削除 |
|-------------|------|-------------|-------------------|---------|--------|---------|--------------|
| `accountingExpenses` | 確定経費 | 日付、科目、税込金額、PL反映区分、OCR、receiptId | 経費登録/未整理確定/編集 | 経費タブ、PL | ○（確認済み+`plTreatment=expense`） | 経費CSV | `isDeleted` 論理削除 / `confirmationStatus=無効` |
| `accountingReceipts` | 領収書ワークフロー | 画像パス、OCR候補、workflow状態、imageHash | 撮影アップロード/OCR/確定 | 未整理一覧、経費フォーム | ×（未整理）/ 経費化後 | 監査CSV（未整理のみ） | 未整理のみ物理削除+Storage画像削除 |
| `accountingFixedCosts` | 固定費マスタ | 名称、科目、月額/年額、開始月、解約月 | 固定費管理画面 | 固定費タブ、PL | ○（有効月の月額） | × | `confirmationStatus=無効`（物理delete不可） |
| `accountingFixedAssets` | 固定/少額資産台帳 | 取得価額、耐用年数、償却スケジュール、expenseId | 経費登録（資産分岐時）/ 台帳編集 | 固定資産台帳、PL | ○（fixed=減価償却費、small=経費側） | 監査CSV | `isDeleted` 論理削除（物理delete不可） |
| `accountingAdjustments` | 売上/経費調整行 | 対象年月、科目、金額、種別 | 売上タブ（非表示） | PL、売上CSV | ○ | 間接（PL CSV） | `confirmationStatus=無効` |
| `accountingExports` | CSV出力履歴 | exportType、fileName、rowCount | Exportタブ保存時 | ×（UI未表示） | × | × | create only |
| `accountingSales` | 手動売上（予備） | — | **未使用** | × | × | × | — |
| `caseRecords` | 確定案件（売上源泉） | 運賃、介助料、精算日時等 | メーターアプリ側 | PL、売上CSV | ○（売上） | 売上CSV | メーター側で管理 |

### 3.2 Firebase Storage

| パス | 用途 | 作成タイミング | 削除 |
|------|------|--------------|------|
| `accounting/{franchiseeId}/{storeId}/receipts/{receiptId}/{fileName}` | 領収書画像 | `uploadAccountingReceiptImage` | 未整理領収書削除時（`deleteAccountingReceipt`） |

**Storage rules**: owner / manager / hq_admin のみ read/write/delete（10MB未満、`image/*` のみ）。**driver は書込不可**。

---

## 4. 経費登録・OCRフロー

```
1. カメラ/画像選択
   → normalizeAccountingReceiptImage
   → uploadAccountingReceiptImage
   → Firestore: status=unorganized, receiptStatus=draft
   → Storage: 画像保存

2. OCR読取（任意）
   → runAccountingReceiptOcr (Tesseract.js, public/tesseract/)
   → applyOcrCandidatesToAccountingReceipt
   → receiptStatus=ocr_ready

3. 「領収書だけ保存」（スマホ向け）
   → saveReceiptOnly → draft/ocr_ready のまま PL未反映

4. 経費フォーム入力
   → 科目選択
   → ExpenseAssetBranchPanel（通常/少額/固定）
   → handleSaveExpense

5. 保存
   → createAccountingExpense（confirmationStatus=確認済み）
   → linkAccountingReceiptToExpense
   → （少額/固定）createAccountingFixedAsset
```

**PL反映条件（経費）**:
- `confirmationStatus === '確認済み'`
- `isDeleted !== true`
- `expenseCategory` が選択済み
- `plTreatment === 'expense'`（固定資産取得時は自動 `excluded`）

---

## 5. 未整理領収書フロー

| 項目 | 内容 |
|------|------|
| 撮影後保存先 | Storage + `accountingReceipts`（`status=unorganized`, `receiptStatus=draft`） |
| OCR後 | `receiptStatus=ocr_ready`、候補フィールド更新 |
| 一覧表示条件 | `status=unorganized` かつ `receiptStatus` が `draft` または `ocr_ready` |
| 編集する | `buildExpenseFormFromReceipt` → 経費タブへ遷移 |
| 確定する | `saveConfirmedAccountingReceipt` + `createAccountingExpense`（科目必須） |
| PL反映タイミング | 経費が **確認済み** になった時点（計上日=`postingDate` の年月） |
| 削除 | **あり**（カード/テーブル）。確認ダイアログ後、Firestore+Storage削除 |
| 削除対象外 | 確定済み（linked/confirmed workflow）、経費紐付け済み |

**不足・リスク**:
- 監査CSVの領収書一覧は **未整理のみ**（確定済み領収書・経費紐付け済み画像は出力対象外）
- 未整理一覧と経費フォームで同一 receipt を編集中の表示制御は `visibleUnorganizedReceipts` フィルタに依存（経費タブ側では非表示）

---

## 6. 固定費管理

- **画面**: `FixedCostManagementPanel`
- **PL反映**: `aggregateFixedCosts` — 対象月に有効なマスタの `monthlyAmountYen` を科目別に固定費へ加算
- **解約**: `cancelYearMonth` 設定で以降月は非計上
- **削除**: UI上「削除」= `invalidateAccountingFixedCost`（無効化）
- **注意**: 同一科目の **経費（確認済み）と固定費マスタは両方PLに加算** される（設計上意図的だが運用で二重入力に注意）

---

## 7. 固定資産・少額資産管理

### 7.1 分岐（経費登録時）

科目選択後、`ExpenseAssetBranchPanel` で以下を選択:

| 区分 | 経費PL | 資産台帳 | 備考 |
|------|--------|---------|------|
| 通常経費 | 全額計上 | なし | 従来どおり |
| 少額資産 | 全額計上（`plTreatment=expense`） | `assetKind=small` | 年間300万円枠表示（10万/40万推奨） |
| 固定資産 | **除外**（`plTreatment=excluded`） | `assetKind=fixed` | 減価償却でPL反映 |

### 7.2 車両・耐用年数

- **車両**: 普通車/軽自動車/福祉車両 → 新品/中古
- **中古車**: 初度登録年月から残存耐用年数を簡易計算（`calculateUsedVehicleUsefulLifeYears`）
- **PC等**: 標準耐用年数（PC/タブレット4年、プリンター5年、ソフトウェア5年等）
- **手動変更**: 適用耐用年数変更時は **変更理由必須**（保存時バリデーション）

### 7.3 固定資産台帳

- **新規登録**: 経費登録からのみ（台帳画面は管理専用）
- **編集可能**: 適用耐用年数、備考（償却スケジュール再計算）
- **削除**: 論理削除（`isDeleted=true`）
- **未実装**: 除却（`status=disposed`）UI/API

### 7.4 PLへの減価償却費

- `aggregateDepreciationExpenses` → 固定費科目 **「減価償却費」** に月額加算
- 定額法、最終月端数調整あり
- 論理削除済み資産・`assetKind=small` は償却PL加算なし

---

## 8. 月次PL・年次PL

### 8.1 データソース

| PL区分 | ソース | 条件 |
|--------|--------|------|
| 売上 | `caseRecords` + 売上調整 | 確定案件の精算年月、調整は `confirmationStatus=確認済み` |
| 売上原価/固定費/変動費（経費） | `accountingExpenses` | 確認済み・未削除・科目選択済み・`plTreatment=expense`・`postingDate`年月 |
| 固定費マスタ | `accountingFixedCosts` | 対象月に有効 |
| 減価償却費 | `accountingFixedAssets` | `assetKind=fixed`、償却期間内、未論理削除 |
| 繰延資産候補 | `accountingExpenses` | `plTreatment=deferredCandidate`（営業利益外） |

### 8.2 計算式

```
粗利益 = 売上小計 − 売上原価小計
営業利益 = 粗利益 − 固定費小計 − 変動費小計
```

- 金額は **税込**（`taxIncludedAmount`）ベース
- 年次PLは **カレンダー年**（1〜12月、前々期/前期/月別/年間合計）

### 8.3 未整理領収書・二重計上

| 質問 | 回答 |
|------|------|
| 未整理領収書はPL反映？ | **いいえ**（draft/ocr_ready のみ） |
| 確定済み経費のみ？ | **はい**（+ plTreatment / isDeleted / 科目） |
| 二重計上リスク | 画像ハッシュ/日付金額の重複警告あり。**固定資産を通常経費で登録**すると全額+償却の二重リスク。立替実費(expenseFare)は売上警告のみ |

---

## 9. 監査資料・CSV/PDF出力

### 9.1 Exportタブ（4種 + export履歴）

| 出力 | 対象データ | 年月指定 | 文字化け対策 |
|------|-----------|---------|-------------|
| 月次PL CSV | 画面PL | ツールバー「対象年月」 | UTF-8 BOM（`\uFEFF`） |
| 年次PL CSV | 年次PL表 | ツールバー「対象年」 | 同上 |
| 確定売上 CSV | caseRecords | 対象年月 | 同上 |
| 経費 CSV | 確認済み・未削除 | 対象年月 | 同上 |

`recordAccountingExport` で `accountingExports` に履歴保存（**UIで履歴参照不可**）。

### 9.2 監査資料タブ（AuditMaterialsPanel）

| 出力 | 形式 | 備考 |
|------|------|------|
| 経費一覧 | CSV | 全確認済み経費（年月フィルタは export 関数側で targetYearMonth ラベルのみ） |
| 領収書一覧 | CSV | **未整理領収書のみ** |
| 少額資産一覧 | CSV | 全件（論理削除除く） |
| 固定資産台帳 | CSV | fixed のみ |
| 減価償却一覧 | CSV | 対象年の月別 |
| 月次/年次PL | CSV | Exportタブと同等 |
| 月次/年次PL | PDF | **サマリー数行のみ**（科目明細なし） |
| 確定売上 | CSV | 対象月案件 |

**不足している出力**:
- 確定済み領収書・経費紐付け画像の一括エクスポート
- 監査向けPDF（科目明細・領収書画像バンドル）
- export履歴の画面表示
- 日付範囲任意指定（現在は年月/年単位）

---

## 10. Firestore rules / indexes

### 10.1 Rules（経理関連）

| コレクション | read | write | delete |
|-------------|------|-------|--------|
| accountingExpenses | canReadAccounting | isAccountingUser + canWrite | **許可** |
| accountingReceipts | 同上 | 同上 | **許可** |
| accountingAdjustments | 同上 | 同上 | 禁止 |
| accountingExports | 同上 | create only | 禁止 |
| accountingFixedCosts | 同上 | 同上 | 禁止 |
| accountingFixedAssets | 同上 | 同上 | 禁止 |
| accountingSales | 同上 | 同上 | 禁止 |

**canReadAccounting**: hq_admin / 同一加盟店owner / 同一店舗manager

**UIとのギャップ**: 画面は owner/hq_admin のみ。rules 上 manager も可だが `/accounting` には入れない。

**既知インシデント**: `accountingFixedAssets` rules は 2026-07-09 にデプロイ済み（未デプロイ時は permission-denied）。

### 10.2 Indexes（accounting関連）

| コレクション | インデックス |
|-------------|-------------|
| accountingExpenses | franchiseeId + transactionDate DESC / + storeId |
| accountingAdjustments | franchiseeId + targetYearMonth DESC |
| accountingExports | franchiseeId + createdAt DESC |
| accountingFixedCosts | franchiseeId + startYearMonth DESC |
| accountingFixedAssets | franchiseeId + purchaseDate DESC / + storeId |
| accountingReceipts | franchiseeId + storeId + createdAt DESC |
| accountingSales | franchiseeId + targetYearMonth DESC |

**リスク**: PL/一覧は **全件fetch + クライアント集計** のため、データ増加時に性能劣化。`postingDate` 用サーバー側range queryは未活用。

---

## 11. 現状不具合・リスク

### 11.1 不具合・仕様ギャップ

| 種別 | 内容 | 深刻度 |
|------|------|--------|
| UI到達性 | `sales` タブ（確定売上・調整行）がメニュー非掲載 | 中 |
| データ記録 | 年次PL CSV export 時 `exportType` が `monthly-pl` と誤記録（L1808） | 低 |
| 監査 | 監査タブで `recordAccountingExport` 未連携 | 低 |
| 未使用 | `accountingSales` コレクション・サービスが未使用 | 低 |
| 除却 | 固定資産 `disposed` 状態のUI/APIなし | 中 |
| 複数仕訳 | `lineItems` 型のみ、UI未実装 | 低 |

### 11.2 権限・インフラリスク

| リスク | 詳細 |
|--------|------|
| UI vs Rules | manager は rules 上書込可だが画面不可 |
| Storage | driver は領収書アップロード不可（撮影運用は owner/manager ログイン前提） |
| Indexes | 未デプロイ環境では receipts 取得 fallback あり。fixedAssets はデプロイ必須だった |
| 物理削除 | expenses/receipts は rules 上 delete 許可（UIは論理削除が主） |

### 11.3 会計・税務リスク

| リスク | 詳細 |
|--------|------|
| 二重計上 | 固定資産を「通常経費」選択時、取得全額PL計上 + 台帳なし |
| 少額資産 | 一括償却/少額減価償却の税務注記・要件確認文言なし |
| 基準不一致 | 固定費プレビュー=会計年度4月起点、PL=カレンダー年 |
| 税込のみ | PL・CSVは税込。税抜・消費税申告用の出力なし |
| OCR | 科目・金額は参考値。確定は人手必須（注記あり） |

### 11.4 UX

| 箇所 | 内容 |
|------|------|
| スマホ | 767px以下はテーブル→カード。経費フォームは縦長 |
| 監査PDF | 実務申告には不十分（サマリーのみ） |
| エラー表示 | 複数コレクション load 失敗時、上部とパネル内に同一エラーが重複表示されうる |

---

## 12. 改善優先順位

| 優先度 | 改善内容 | 理由 | 影響範囲 | 難易度 | 期待効果 |
|--------|---------|------|---------|--------|---------|
| **P1** | 固定資産登録時の二重計上防止（通常経費選択時警告/固定資産必須化） | PL正確性・入力漏れ防止 | 経費保存、PL | 低 | 取得全額の誤計上防止 |
| **P1** | 確定売上・調整行をメニュー復帰 or 監査/PLからリンク | 売上調整が実質使えない | AccountingPage | 低 | PLの売上精度向上 |
| **P2** | 監査CSVに確定済み領収書/経費紐付け画像メタデータ追加 | 申告資料化 | accountingCsv, AuditPanel | 中 | 監査対応力向上 |
| **P2** | 監査PDFの科目明細化（最低限PL表PDF） | 申告資料化 | AuditMaterialsPanel | 中 | 印刷・提出の実用性 |
| **P2** | 固定資産除却(disposed)フロー | PL・台帳の正確性 | fixedAssets service/UI | 中 | 償却終了後の管理 |
| **P3** | manager の経理画面アクセス or rules/UI整合 | FC展開・現場入力 | permissions, rules | 中 | 運用分担の柔軟化 |
| **P3** | PL/経費のサーバー側年月クエリ + ページング | 性能・スケール | services, indexes | 高 | データ増加耐性 |
| **P3** | 会計年度PL表示（4月起点）オプション | 税務確認しやすさ | accountingPl | 中 | 決算期との整合 |
| **P4** | export履歴UI、`recordAccountingExport` 監査タブ連携 | 監査証跡 | Export/Audit | 低 | 出力管理 |
| **P4** | 税務注記（OCR参考値・少額資産・税込集計）の明示 | 税務確認 | UI文言 | 低 | 誤解防止 |

---

## 13. 次に実装すべき内容

1. **P1: 固定資産の誤登録防止** — 高額取得時に「固定資産」未選択への警告強化
2. **P1: 売上調整UIのメニュー復帰** — 調整行がPLに効くよう到達性確保
3. **P2: 監査出力の実務強化** — 確定領収書メタデータCSV、PL明細PDF
4. **P2: 固定資産除却** — 償却完了/売却/disposed 状態管理
5. **P3: 権限モデル整理** — manager経理由来 or 撮影専用フロー（driver Storage）

---

## 付録: 調査した主要ファイル

| パス | 役割 |
|------|------|
| `src/pages/AccountingPage.tsx` | 経理画面本体 |
| `src/pages/AccountingPage.css` | レスポンシブUI |
| `src/types/accounting.ts` | 経費・PL型 |
| `src/types/accountingFixedAssets.ts` | 固定/少額資産型 |
| `src/types/accountingCategoryMaster.ts` | 科目マスタ・PL区分 |
| `src/types/accountingReceiptWorkflow.ts` | 領収書ワークフロー |
| `src/types/permissions.ts` | 経理アクセス権 |
| `src/utils/accountingPl.ts` | PL計算エンジン |
| `src/utils/accountingDepreciation.ts` | 償却計算 |
| `src/utils/accountingCsv.ts` | CSV生成 |
| `src/utils/accountingExpenseForm.ts` | 経費フォーム・OCR反映 |
| `src/utils/accountingExpenseDuplicate.ts` | 二重計上検知 |
| `src/utils/accountingSalesMapping.ts` | caseRecords→売上 |
| `src/services/accountingExpenses.ts` | 経費CRUD |
| `src/services/accountingReceipts.ts` | 領収書・Storage |
| `src/services/accountingFixedCosts.ts` | 固定費マスタ |
| `src/services/accountingFixedAssets.ts` | 固定資産台帳 |
| `src/services/accountingAdjustments.ts` | 調整行 |
| `src/services/accountingExports.ts` | 出力履歴 |
| `src/services/accountingTenant.ts` | テナント制約 |
| `src/components/accounting/*.tsx` | 各サブパネル |
| `firestore.rules` | Firestoreセキュリティ |
| `firestore.indexes.json` | 複合インデックス |
| `storage.rules` | 領収書画像 |

---

*本レポートはコードベース静的調査に基づく。実機での権限・OCR精度・税務適合性は別途実機テストで確認すること。*
