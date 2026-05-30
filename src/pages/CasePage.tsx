import { Link } from 'react-router-dom'

export function CasePage() {
  return (
    <main className="page" aria-labelledby="case-title">
      <section className="content-card">
        <p className="eyebrow">Case</p>
        <h1 id="case-title">仮案件画面</h1>
        <p className="lead">案件開始・案件一覧の詳細機能は今後実装します。</p>
        <Link className="text-link" to="/">
          ホームへ戻る
        </Link>
      </section>
    </main>
  )
}
