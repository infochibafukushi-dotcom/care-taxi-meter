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

- 住所取得は Google Maps Platform の Geocoding API で逆ジオコーディングを行います。
- ブラウザでは Google Maps JavaScript API をロードし、その `Geocoder` から Geocoding を実行します。
- 必須の環境変数名は `VITE_GOOGLE_MAPS_API_KEY` です。
- GitHub Pages で利用する場合、API キーには公開URLの HTTP referrer 制限と Maps JavaScript API / Geocoding API の API 制限を設定してください。

### GitHub Actions / GitHub Pagesでの取得設計

- GitHub Pages のビルドは `.github/workflows/deploy-github-pages.yml` の `Build` step で実行されます。
- `VITE_GOOGLE_MAPS_API_KEY` は `secrets.VITE_GOOGLE_MAPS_API_KEY || vars.VITE_GOOGLE_MAPS_API_KEY` から読み込まれ、`npm run build:pages` に渡されます。
- `VITE_` で始まる値は Vite の仕様上、ビルド後のブラウザ用JavaScriptへ埋め込まれます。そのため **秘匿値として守るのではなく、HTTP referrer 制限と API 制限で保護する公開前提のキー** として扱ってください。
- 推奨設定場所は **Repository variable** です。
  - GitHub: `Settings` → `Secrets and variables` → `Actions` → `Variables` → `Repository variables`
  - キー名: `VITE_GOOGLE_MAPS_API_KEY`
- Repository secret でも workflow は同じキー名で読み込めますが、最終的にフロントエンド成果物へ埋め込まれるため、Repository variable を推奨します。
- `github-pages` Environment の variables にだけ設定しても、この workflow の `build` job では読み込まれません。必ず Repository variable、または Repository secret に設定してください。

### 必要なGoogle API

1. Maps JavaScript API
   - ブラウザで `https://maps.googleapis.com/maps/api/js` をロードし、`google.maps.importLibrary('geocoding')` と `Geocoder` を利用するために必要です。
2. Geocoding API
   - 緯度経度から住所へ変換する逆ジオコーディングに必要です。

### Google Cloud ConsoleでのAPIキー設定

1. Google Cloud Console で API キーを作成します。
2. APIキーの「API の制限」で以下の2つを許可します。
   - Maps JavaScript API
   - Geocoding API
3. APIキーの「アプリケーションの制限」は `HTTP リファラー（ウェブサイト）` にします。
4. GitHub Pages の公開URLを HTTP referrer として登録します。
   - 例: `https://<owner>.github.io/care-taxi-meter/*`
   - カスタムドメインを使う場合は、その公開URLも追加します。

### GitHub Pages運用での設定手順

1. GitHub リポジトリの `Settings` → `Secrets and variables` → `Actions` → `Variables` に移動します。
2. Repository variable として `VITE_GOOGLE_MAPS_API_KEY` を追加し、Google Maps Platform の API キーを設定します。
3. `main` または `work` ブランチへ push するか、`Deploy GitHub Pages` workflow を手動実行して再デプロイします。
4. GitHub Actions の `Deploy GitHub Pages` workflow が成功したことを確認します。
5. スマホ実機で案件画面を開き、`住所取得診断` パネルで以下を確認します。
   - `Google Maps APIロード状態`: `成功`
   - `Geocoder生成状態`: `生成成功`
   - `Geocoding実行状態`: `成功`
   - `Googleレスポンス件数`: `1` 以上
   - `formatted_address`: 住所文字列が表示される
   - `取得住所`: 住所文字列が表示される

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
