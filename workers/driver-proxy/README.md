# care-taxi-meter driver API proxy (Cloudflare Worker)

GitHub Pages 本番向けに、フロントから `reservation-v4` の driver API を呼ぶためのトークン非露出プロキシです。

## 役割

- ブラウザは Worker の公開 URL（`VITE_RESERVATION_API_BASE_URL`）だけを知る
- Worker が `METER_DRIVER_TOKEN` を付与して `RESERVATION_V4_ORIGIN` へ転送する
- `METER_DRIVER_TOKEN` は Cloudflare Secrets のみに保持し、GitHub / Vite / dist には入れない

## 許可する API

| Method | Path |
|--------|------|
| GET | `/api/driver/reservations?date=YYYY-MM-DD` |
| GET | `/api/driver/reservations/:reservationId` |
| POST | `/api/driver/reservations/:reservationId/start-fixed-fare` |
| POST | `/api/driver/reservations/:reservationId/complete-fixed-fare` |
| POST | `/api/driver/reservations/:reservationId/reset-fixed-fare` |

その他のパスは `404`、許可パスへの未対応メソッドは `405` です。`OPTIONS` は CORS preflight 用に許可パスのみ受け付けます。

## 環境変数

| 名前 | 種別 | 説明 |
|------|------|------|
| `METER_DRIVER_TOKEN` | Secret | reservation-v4 driver API 用 Bearer トークン |
| `RESERVATION_V4_ORIGIN` | Var | HTTP フォールバック用の上流 origin（本番は Service Binding 推奨） |
| `RESERVATION_V4` | Service Binding | reservation-v4 Worker（`throbbing-bush-8f59`）へのバインド |
| `ALLOWED_ORIGIN` | Var | CORS 許可する GitHub Pages の origin（例: `https://<org>.github.io`） |

## デプロイ例

```bash
cd workers/driver-proxy
npm install
wrangler secret put METER_DRIVER_TOKEN
wrangler deploy
```

公開 URL が `https://driver-api.example.com` の場合、GitHub Pages ビルドでは次を設定します。

```text
VITE_RESERVATION_API_BASE_URL=https://driver-api.example.com
```

フロントは `${VITE_RESERVATION_API_BASE_URL}/api/driver/...` を呼び出します。

## ローカル開発

アプリ本体は従来どおり Vite dev proxy（`.env.local` の `METER_DRIVER_TOKEN`）を使います。Worker は本番 / 検証用です。

```bash
npm run dev
```

Worker 単体:

```bash
cd workers/driver-proxy
npm run dev
```

## テスト

```bash
cd workers/driver-proxy
npm test
```

## セキュリティ上の注意（次フェーズ）

**CORS 制限だけでは curl 等の直接アクセスを防げません。** 現段階では Worker URL を知っているクライアントは、ブラウザ外からも driver API を呼べます（共有サービストークンと同等のリスク）。

本番では `workers.dev` 間の HTTP fetch が失敗するため、`throbbing-bush-8f59` への **Service Binding** を使います（`wrangler.toml` 参照）。

次フェーズで **Firebase ID Token / JWT 検証** を Worker に追加し、ログイン済みドライバーのみ転送する予定です。
