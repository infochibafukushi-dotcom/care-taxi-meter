import { Link } from 'react-router-dom'

export function HomePage() {
  return (
    <main className="page page--home" aria-labelledby="home-title">
      <section className="hero-card">
        <p className="eyebrow">Care Taxi Meter</p>
        <h1 id="home-title">ケアタクシーメーター</h1>
        <p className="lead">
          介護タクシー専用メーターアプリの画面構成土台です。GPS、料金計算、領収書はまだ実装していません。
        </p>
        <nav className="home-actions" aria-label="主要メニュー">
          <Link className="primary-action" to="/case">
            案件開始ボタン
          </Link>
          <Link className="secondary-action" to="/cases">
            案件一覧ボタン
          </Link>
          <Link className="secondary-action" to="/admin">
            管理画面ボタン
          </Link>
        </nav>
      </section>
    </main>
  )
}
