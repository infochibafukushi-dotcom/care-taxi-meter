import './App.css'

function App() {
  return (
    <main className="app-shell">
      <section className="hero-card" aria-labelledby="app-title">
        <p className="eyebrow">Care Taxi Meter</p>
        <h1 id="app-title">介護タクシー専用メーター</h1>
        <p className="lead">
          React + TypeScript + Vite + Firebase + PWA の初期プロジェクトです。
          GPS、料金計算、領収書機能はまだ実装していません。
        </p>
        <div className="status-grid" aria-label="初期設定の状態">
          <div>
            <span>Frontend</span>
            <strong>React / TypeScript</strong>
          </div>
          <div>
            <span>Backend</span>
            <strong>Firebase ready</strong>
          </div>
          <div>
            <span>Install</span>
            <strong>PWA ready</strong>
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
