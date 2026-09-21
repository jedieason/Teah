# Firebase 設定與上線指引

目前使用 **Realtime Database**，不是 Firestore。題目仍位於資料庫根目錄，命名如 `檢驗醫學區段一｜B10 考古`。本機 `QuestionBank/` 僅供參考，不假設它與線上題庫完全相同。

## 1. 先備份，再建立獨立題庫目錄

原程式為列出題庫會讀取 `/`，這會同時讀到該節點下的個人進度、錯題與其他資料。新版先讀 `/quizCatalog`，只有目錄不存在時才相容舊根目錄讀取。

在 Firebase Console → Realtime Database → Data 匯出目前資料庫，將備份保存在專案以外的私人位置。不要提交備份到 Git。

```sh
npm run catalog -- /私人位置/firebase-export.json firebase/quiz-catalog.generated.json
```

產生工具只讀取備份，不連線 Firebase；只輸出題庫名稱、題數與穩定儲存名稱，不輸出使用者或金鑰資料。重複輸出會拒絕覆蓋檔案。

在 Console 建立 **`/quizCatalog` 節點**，選取該節點後匯入產生檔案。**不要在根目錄匯入目錄 JSON**，以免取代其他資料。

```json
{
  "檢驗醫學區段一｜B10 考古": {
    "count": 60,
    "storageKey": "檢驗醫學區段一｜B10 考古"
  }
}
```

題庫本體不用搬動。`storageKey` 用來讓重新命名或典藏後仍對應相同的進度與錯題。新版題庫管理會在單一多路徑更新中一起維護題庫與目錄。直接在 Console 改名或匯入時，也必須維護目錄；改名時保留原 `storageKey`。

## 2. Authentication

Firebase Console → Authentication → Sign-in method 啟用 Google。Settings → Authorized domains 加入正式網站網域，以及開發使用的 `localhost`／`127.0.0.1`。Firebase 客戶端設定集中於 `src/services/firebase.js`。Firebase Web API key 屬客戶端專案識別設定；資料存取仍由 Rules 控制。

## 3. 管理員與個人資料權限

參考 `firebase/database.rules.example.json`。這是需在測試專案確認的範例，沒有連接到自動部署：

- `/quizCatalog` 可讀取題庫目錄；只有管理員可寫入。
- 題庫內容供已登入使用者讀取；建立、改名、典藏及勘誤要求 `auth.token.admin === true`。
- `/progress/{uid}` 與 `/mistakes/{uid}` 只允許本人讀寫。
- 根目錄不允許整批讀取。
- `/API_KEY` 不允許瀏覽器讀寫。

管理員 custom claim 必須由可信任的 Admin SDK 環境設定，不能從前端自行宣告。概念範例（保留原有 claims）：

```js
const user = await admin.auth().getUser(adminUid);
await admin.auth().setCustomUserClaims(adminUid, { ...user.customClaims, admin: true });
```

設定後重新登入取得新 token。若目前有不同的管理員制度，先把範例條件調整成現有制度。範例未對歷史進度的所有欄位加嚴格 schema 驗證，以保留舊資料相容性。

**順序：先建立完整目錄、部署新版前端、確認管理員，再測試規則。** 不可在仍依賴根讀取的舊前端上直接禁止根讀取。Firebase 的較上層 `.read`／`.write` 一旦允許，不能靠下層規則重新限制，因此不能保留根目錄的全面允許規則。

## 4. AI 回覆仍需後端改造

現有 Gemini 整合從 `/API_KEY` 取得模型 API key 並由瀏覽器直接請求。這次先修正原詳解被覆寫及錯誤提示；**沒有把金鑰改成安全的後端代理**。

正式上線建議將 Gemini 請求放入 Cloud Functions 或 Cloud Run：驗證 Firebase ID token、限制請求長度及使用頻率、以 Secret Manager 保存 Gemini key，由伺服器呼叫模型。確認新代理可以使用後，換掉 `src/app.js` 的 Gemini 呼叫及金鑰讀取。

本輪產品化按要求保留前端 API，因此規則範例僅允許已登入者讀取 `/API_KEY`，仍禁止根目錄讀取。**登入者依然能取得金鑰，這不是後端金鑰保護。** 完成代理後應將 `/API_KEY` 的 `.read` 改回 `false` 並輪替金鑰。答題、詳解、收藏及錯題複習不依賴 AI。

## 5. 上線驗收

先在 Firebase Emulator 或測試專案逐項測試，再套用正式環境：

1. 未登入者可列出目錄，不能讀取題目、進度或錯題。
2. 帳號 A 無法讀寫帳號 B 的 `progress` 或 `mistakes`。
3. 一般使用者可以續答、收藏、記錄錯題；不能改名、典藏、上傳或勘誤共用題庫。
4. 管理員可以管理題庫，改名後原進度與錯題仍可找到。
5. 兩個裝置同時對同一題答錯，次數不會因讀取後覆寫而漏計。
6. 斷線時有提示；恢復連線後順序重試，畫面和遠端紀錄一致。
7. 複習不覆蓋正常進度；舊填空、多選及長題幹均可使用。

`npm run test:rules` 已加入 Rules Emulator 自動測試；本地測試不連接線上 Firebase，仍不能代替正式規則部署、真實登入與跨裝置驗收。完整新資料結構及上線步驟見 [產品化交接](productization.md)。

## 官方參考

- [Realtime Database 讀寫、交易與多路徑更新](https://firebase.google.com/docs/database/web/read-and-write)
- [Realtime Database 規則的繼承與路徑結構](https://firebase.google.com/docs/database/security/core-syntax)
- [Custom claims 管理員角色](https://firebase.google.com/docs/auth/admin/custom-claims)
- [Cloud Functions 機密參數](https://firebase.google.com/docs/functions/config-env)
