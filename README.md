# 介護タクシー専用メーター

React + TypeScript + Vite + Firebase + PWA で構成した初期プロジェクトです。
現時点では土台作成のみを目的としており、GPS、料金計算、領収書の各機能は実装していません。

## セットアップ

```bash
npm install
npm run dev
```

Firebase の実プロジェクト情報は `.env.example` をコピーして `.env.local` に設定します。

```bash
cp .env.example .env.local
```

## フォルダ構成

```text
.
├── public/                 # 静的ファイル、PWAアイコン
├── src/
│   ├── lib/
│   │   └── firebase.ts     # Firebaseアプリ初期化
│   ├── App.css             # 初期画面スタイル
│   ├── App.tsx             # 初期画面コンポーネント
│   ├── index.css           # グローバルスタイル
│   ├── main.tsx            # React起動とPWA登録
│   └── vite-env.d.ts       # Vite / PWA / Firebase環境変数型定義
├── index.html              # HTMLエントリーポイント
├── package.json            # npm scripts と依存関係
└── vite.config.ts          # Vite / React / PWA設定
```

## Firebase設定

- Firebase SDK は `firebase` パッケージを利用します。
- `src/lib/firebase.ts` は `VITE_FIREBASE_*` 環境変数を読み込み、Firebaseアプリを初期化します。
- 秘密情報やプロジェクト固有の値はコミットせず、`.env.local` で管理します。

## PWA設定

- `vite-plugin-pwa` を導入しています。
- `vite.config.ts` で Web App Manifest、テーマカラー、アイコン、Workbox の基本設定を定義しています。
- `src/main.tsx` で Service Worker を登録し、自動更新する設定にしています。

## 利用可能なコマンド

```bash
npm run dev      # 開発サーバー起動
npm run build    # TypeScriptチェックと本番ビルド
npm run lint     # ESLintチェック
npm run preview  # ビルド結果のプレビュー
```
