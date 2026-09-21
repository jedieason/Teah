# 題矣

醫學生的考古刷題網頁。沿用現有白底、藍色重點色與答題介面，題庫資料來自 Firebase Realtime Database。

## 開發

需要 Node.js 20 以上。

```sh
npm run dev          # http://127.0.0.1:4173
npm test             # 錯題資料與答題狀態測試
npm run check        # JavaScript 與 HTML 結構檢查
npm run build        # 產生可部署的 dist/
```

一般開發與建置不需要第三方 Node 套件。瀏覽器端的 Firebase、KaTeX、Marked、DOMPurify 使用固定版本 CDN，需要網路連線。Google 登入須在 Firebase Authentication 加入開發網域。

瀏覽器驗證使用獨立測試資料，攔截 Firebase 服務模組，不會讀寫正式資料：

```sh
npm install
npx playwright install chromium
npm run dev
# 另一個終端機
npm run test:browser
```

若使用現有 Chrome，可設定 `CHROME_PATH`；`PLAYWRIGHT_MODULE` 可指定已安裝的 Playwright 模組路徑。測試截圖輸出至 `artifacts/qa/`。

## 專案結構

```text
index.html                    頁面結構
src/
  app.js                      答題流程、登入及功能整合
  features/mistakes/
    model.js                  錯題正規化、篩選、狀態轉換
    notebook.js               錯題本介面與互動
  services/
    firebase.js               Firebase SDK 初始化與連線
    catalog.js                題庫目錄、原子更新與名稱識別
  shared/
    content.js                Markdown 安全輸出、題庫格式驗證
    select-menu.js            自訂篩選選單與鍵盤操作
    dialogs.js                彈窗焦點及鍵盤操作
styles/
  base.css                    既有答題版面與品牌樣式
  interface.css               首頁與共用介面元件
  notebook.css                錯題本版面
  select-menu.css             自訂選單
  dialogs.css                 共用彈窗、開始與結束介面
scripts/                      開發伺服器、檢查、建置、目錄產生工具
tests/                        單元測試及隔離後端的瀏覽器測試
firebase/                     權限規則範例（不會自動部署）
docs/                         Firebase 設定及功能規格
QuestionBank/                 本機題庫參考，不隨前端部署
Images/、fonts/               既有品牌素材
```

`src/app.js` 保留既有答題控制器與舊版進度相容邏輯；錯題領域與資料服務已獨立。後續可逐步抽出登入、收藏、題庫管理，避免一次改寫答題頁造成行為差異。

## 本版功能

- 錯題本支援搜尋、科目／題庫篩選、最近／次數／最久未回顧排序。
- 詳解預設收合，顯示上次作答、正確答案、出處及錯誤次數。
- 可練習篩選結果或跨題庫選取題目，複習不覆寫原測驗進度。
- 連續答對兩次會標為已熟悉，再答錯會移回待複習；狀態也可手動往返調整。
- 點題庫先提供續答或重新開始；進度以實際已作答題數顯示。
- 收藏使用交易更新；AI 回覆不再覆寫原詳解；匯入前檢查資料格式與同名題庫。
- 同步失敗會提示並在恢復連線時重試。重試佇列僅保留於目前頁面，尚不支援完整離線使用。

詳細行為見 [錯題規格](docs/mistakes.md)，上線前設定見 [Firebase 指引](docs/firebase.md)。

## 部署

`npm run build` 只複製前端需要的檔案。`firebase.json` 將 Hosting 指向 `dist/`；不包含資料庫規則部署，避免在尚未完成目錄與權限設定時誤套用。

```sh
firebase deploy --only hosting --project stock-market-ntumed
```

本次程式修改不會自動部署網站、匯入題庫或變更 Firebase 規則。正式登入、跨裝置同步與目前線上權限仍須依設定指引驗收。

## 作者與授權

原作者：Jedieason。沿用原專案的使用說明：可自由使用，保留原作者說明，不改署名。

## 學習引擎與產品化

新增自訂組題、學習／考試模式、逐次作答、離線待送佇列、學習總覽、複習排程、計畫、筆記／複習卡、內容審核與回報、帳戶資料管理及 PWA。詳見 [產品化交接與 Firebase 匯入步驟](docs/productization.md)。資料檔已在本機遷移，程式建置不包含匯出檔或備份；正式資料與權限規則仍需分別匯入／發佈。
