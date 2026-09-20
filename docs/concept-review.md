# 測驗完成後的 AI 觀念回顧

一般測驗與錯題複習完成後，保留原有成績和操作，並自動生成一份整體學習 overview。全部答對時顯示空狀態，不呼叫 AI。

一次請求包含本次所有已作答且答錯的題目、實際選擇、答案、題庫詳解與來源；先透過 `canonicalQuestion` 還原打亂的選項代號。模型以跨題共同觀念歸納，不能每題各生成一張卡。

## 輸出契約

`src/features/concept-review/model.js` 定義 system prompt、Gemini responseSchema 和執行期驗證：

- `summary`：整體學習缺口與方向。
- `studyAreas`：1–6 個依閱讀優先順序排列的觀念群，含單元、觀念群標題、可能盲點、具體閱讀範圍與相關題號。每個錯題必須恰好歸入一群，避免遺漏與重複計算。
- `remember`：從全部錯題提煉的 1–5 個立即記憶重點，包含可背誦規則與鑑別條件，不與題數一一對應。
- `uncertainty`：需核對的資料缺口或題庫矛盾。

CSS 以既有 UI tokens 渲染閱讀順序、錯題分布橫條和記憶卡；橫條由實際題號計算，並非 AI 估算的能力分數。相關題目預設收合。所有模型文字使用 textContent，模型不產生 HTML/CSS，prompt 禁止 emoji。

沿用既有 Gemini 模型與 Firebase API_KEY 設定。請求有 90 秒逾時、重試、JSON 結構與完整涵蓋驗證；離開結果頁會中止生成，避免舊回應污染新測驗。回顧僅保留在當前結果頁，不存入 Firebase。

## 驗證

`npm test` 驗證選項還原、整份輸入、跨題合併、題號完整性和格式錯誤。
`npm run test:browser` 使用隔離 Firebase 和 Gemini fixture，驗證兩題整合成一個方向、記憶卡、重試、手機溢出與既有流程，產出桌面、手機、深色模式截圖。不呼叫正式 AI 服務。
