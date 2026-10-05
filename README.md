# OX 台股

獨立台灣市場專案。台股功能以 2026-10-05 22:03 的最新來源版本 0c193666f65f51022f02a99d81d4ba6454cfa949 搬遷。原站未改動。

資料服務、部署、收藏、畫線和主題設定皆獨立；沒有其他市場入口、原站 API 或帳號依賴。

## 開發

```sh
npm ci
npm run build
npm test
npm run dev
```

本專案只提供台股市場。資料快照以搬遷時的最新版為基準；獨立每日更新排程尚未設定。

線上版本：https://ox-tw-independent.btcfly.chatgpt.site

## GitHub Pages

執行 `npm ci`、`npm run build:pages`、`npm test`。部署流程位於 `.github/workflows/deploy-pages.yml`，將 `dist/client` 上架至 GitHub Pages。

GitHub Pages 設定需選擇 GitHub Actions 作為 Source。此帳號的私人儲存庫不能啟用 Pages，須由擁有者確認公開後啟用；尚未啟用前不代表正式網站已上線。

前端以 `/ox-tw-independent/` 為子目錄；資料 API 使用本專案獨立服務 `https://ox-tw-independent.btcfly.chatgpt.site/api`，該服務須公開才能由 github.io 網頁讀取。沒有使用原混合市場站的 API。
