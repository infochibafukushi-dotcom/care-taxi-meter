import { Link } from 'react-router-dom'

export function AdminPage() {
  return (
    <main className="page" aria-labelledby="admin-title">
      <section className="content-card">
        <p className="eyebrow">Admin</p>
        <h1 id="admin-title">仮管理画面</h1>
        <p className="lead">管理画面の設定・集計機能は今後実装します。</p>
        <Link className="text-link" to="/">
          ホームへ戻る
        </Link>
      </section>
    </main>
  )
}
