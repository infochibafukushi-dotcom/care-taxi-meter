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

## ルーティング

React Router を導入し、以下の仮画面を用意しています。

| パス | 画面 |
| --- | --- |
| `/` | HomePage |
| `/case` | CasePage |
| `/admin` | AdminPage |

## フォルダ構成

```text
.
├── public/                 # 静的ファイル、PWAアイコン
├── src/
│   ├── components/         # 共通コンポーネント
│   ├── hooks/              # カスタムフック
│   ├── layouts/            # 画面レイアウト
│   │   └── AppLayout.tsx
│   ├── pages/              # ルーティング対象画面
│   │   ├── AdminPage.tsx
│   │   ├── CasePage.tsx
│   │   └── HomePage.tsx
│   ├── services/           # 外部サービス連携
│   │   └── firebase.ts     # Firebaseアプリ初期化
│   ├── store/              # 状態管理
│   ├── types/              # 共通型定義
│   ├── utils/              # ユーティリティ
│   ├── App.css             # 画面スタイル
│   ├── App.tsx             # React Router設定
│   ├── index.css           # グローバルスタイル
│   ├── main.tsx            # React起動とPWA登録
│   └── vite-env.d.ts       # Vite / PWA / Firebase環境変数型定義
├── index.html              # HTMLエントリーポイント
├── package.json            # npm scripts と依存関係
└── vite.config.ts          # Vite / React / PWA設定
```

## Firebase設定

- Firebase SDK は `firebase` パッケージを利用します。
- `src/services/firebase.ts` は `VITE_FIREBASE_*` 環境変数を読み込み、Firebaseアプリを初期化します。
- 秘密情報やプロジェクト固有の値はコミットせず、`.env.local` で管理します。

## Google Geocoding API設定

- 住所取得は Google Geocoding API の逆ジオコーディングを利用します。
- `VITE_GOOGLE_MAPS_API_KEY` に Google Maps Platform の API キーを設定してください。
- GitHub Pages で利用する場合、API キーには公開URLの HTTP referrer 制限と Geocoding API の API 制限を設定してください。

### GitHub Pages運用での設定手順

1. Google Cloud Console で Geocoding API を有効化し、API キーを作成します。
2. API キーの「アプリケーションの制限」は HTTP リファラーにし、GitHub Pages の公開URLを登録します。
   - 例: `https://<owner>.github.io/care-taxi-meter/*`
3. API キーの「API の制限」は Geocoding API のみにします。
4. GitHub リポジトリの `Settings` → `Secrets and variables` → `Actions` → `Variables` に移動します。
5. Repository variable として `VITE_GOOGLE_MAPS_API_KEY` を追加し、Google Maps Platform の API キーを設定します。
   - `VITE_` 環境変数はビルド後のブラウザ用JavaScriptに含まれるため、秘匿値ではありません。HTTP リファラー制限と API 制限で保護してください。
   - Repository secret として設定した場合も、GitHub Actions のビルドでは同じ名前で読み込めます。
6. `main` または `work` ブランチへ push するか、`Deploy GitHub Pages` workflow を手動実行して再デプロイします。

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
