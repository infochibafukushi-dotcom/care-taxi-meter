/**
 * Firestore スキーマ追加（SQL マイグレーションではない）
 *
 * まとめ経費・任意レポート機能で追加したコレクション / フィールド。
 *
 * ## 新規コレクション
 * - accountingExpenseGroups
 * - accountingExpenseReports
 *
 * ## accountingExpenses 追加フィールド（既存ドキュメントは未設定 = null 扱い）
 * - expenseGroupId: string | null
 * - reportId: string | null
 *
 * ## Storage
 * - accounting/{franchiseeId}/{storeId}/reports/{reportId}/...
 *
 * デプロイ時:
 * 1. firestore.rules / storage.rules をデプロイ
 * 2. firestore.indexes.json をデプロイ（複合インデックス作成完了を待つ）
 * 3. フロントをデプロイ
 */
export {}
