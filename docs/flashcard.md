# Flashcard：Quizlet 研究與實作規格

研究與驗證日期：2026-10-03（Asia/Taipei）。本功能是新的私人單字題庫，入口為側邊欄 **Flashcard**。既有「複習卡」仍使用原本的題目與資料路徑。

## 證據範圍

使用 Quizlet 官方說明、官方技術文章，以及公開字卡集的桌面版實際操作。實測字卡集為 [STAT 121: Lesson 29，17 張](https://quizlet.com/590765484/stat-121-lesson-29-flash-cards/)。實測涵蓋 Flashcards、Learn 前兩輪、選擇題的答對／答錯／不知道、重試與結算、完整選項、Write 錯誤結果。建立頁起初要求登入，後續重新開啟遇到人工驗證；未操作驗證，因此匯入／建立／編輯以官方文件為依據，沒有冒稱已完成登入後全流程實测。

Quizlet 未公開當前 Learn 完整排程程式、模型權重、所有帳戶版本與實驗分組。本版重現可觀察的主要學習流程，使用可檢查的 Teah 排程，不宣稱取得 Quizlet 的專有演演算法或達成每一帳戶版本的像素級一致。

以下分為：**文件確認**、**當次實測**、**Teah 設計**。歷史文章只能支持其發表時的產品／研究方向。

## 匯入與編輯

| 功能 | 研究依據 | 本版行為 |
| --- | --- | --- |
| 批次貼上 | 官方匯入說明 | 單字與解釋可用 Tab、comma、dash；字卡間可用換行或分號 |
| 自訂符號 | 官方建立指南 | 兩種分隔符可分別自訂；可用 `::` 與 `||`，也支援文字 `\\t`、`\\n` |
| 預覽 | 官方建立指南 | 立即顯示筆數、格式問題、重複數與前 200 筆；確認後加入現有字卡 |
| 編輯 | 官方建立／編輯說明 | 兩欄單字／解釋、語言、拖曳、上下移、插入下一張、刪除與復原、交換兩欄 |
| 新增 | 官方建立／編輯說明 | 最後一張解釋按 Tab 可新增下一張，亦可按新增字卡 |
| 格式 | 官方建立說明 | 粗體、斜體、底線、標示；透過安全 DOM 呈現，HTML 作為文字 |
| 草稿 | 官方建立說明 | 停止輸入 350 ms 後存在此裝置 IndexedDB；回到編輯可恢復；正式儲存後清除草稿 |
| 替代答案 | Teah 設計 | 每面最多 12 個，每行一個；用於書寫批改與複選 |
| 匯出 | Teah 設計 | 使用相同分隔符控制下載文字檔 |

來源：[官方匯入說明](https://help.quizlet.com/hc/en-us/articles/360029977151-Creating-sets-by-importing-content)、[建立指南](https://quizlet.com/blog/how-to-create-the-best-quizlet-sets)、[建立字卡集](https://help.quizlet.com/hc/en-us/articles/360029780752-Creating-study-sets/)、[編輯字卡集](https://help.quizlet.com/hc/en-au/articles/360030212131-Editing-sets)。

可直接貼入的例子：

```text
apple,蘋果
banana,香蕉
pear,梨
```

設定：單字與解釋「逗號」，字卡與字卡「換行」。從試算表複製兩欄時選 Tab／換行。多行解釋可使用自訂字卡分隔符：

```text
apple::紅色或綠色
水果||banana::黃色水果
```

設定：單字 `::`、字卡 `||`。解析每列第一個單字分隔符，後面的相同符號保留於解釋；空列略過，CRLF／CR 正規化成 LF、移除 BOM。這是分隔符貼上工具，不是帶引號跳脫的 RFC CSV 解析器。分隔符本身出現在內容時需換符號。重複卡保留並提示。缺少一面會阻止匯入；分隔符最多 20 字元、貼上最多 4,000,000 字元、每組最多 2000 張、每面最多 4000 字元。這些上限是 Teah 的限制。

## Flashcards

官方說明確認可翻面、切換正面、自動播放、打亂、標星號與分類為知道／還在學習。當次桌面畫面預設關閉追蹤進度；開啟才出現分類操作。[官方 Flashcards 說明](https://help.quizlet.com/hc/en-us/articles/360030988091-Studying-with-Flashcards)。

本版：

- 預設顯示單字正面，追蹤進度關閉；上方可直接開啟。正面也可改成解釋。
- 卡片點擊或空白鍵翻面；3D rotateX、480 ms。兩面都有可讀內容，背面隱藏時設 aria-hidden。
- 開啟分類：左鍵／左滑為還在學習，右鍵／右滑為知道；分類卡片向對應方向移出，210 ms 後切換。沒有追蹤時左右鍵只換卡。
- 上一張／下一張、Backspace 回上一張、打亂、自動播放（每面 2.2 秒）、語音與星號。
- 每次翻面／換卡／分類均保存；重新整理回到同一張和同一面。自動播放不會在重新載入時自行啟動。
- 結束時列出兩種分類數，可只重練本輪還在學習的卡；最後的分類同時保存在歷史，Learn 可把同方向「知道」的卡從熟悉階段開始。
- Flashcards 的分類紀錄與 Learn 答題紀錄分開；翻面、瀏覽不會算成一次答對。
- 切換頁面、隱藏分頁、開啟設定會停止播放／朗讀。減少動態效果設定關閉過場動畫。

動畫時間與鍵盤配置為 Teah 實作參數，沒有把人工觀察當成 Quizlet 原始毫秒數。

## Learn 的實際觀察

### 題型與選項

當次快速選項預設啟用單選、複選、書寫；字卡題型關閉。快速選項另有打亂、只學星號、音效。完整選項有作答方向、圖片、三種書寫批改、重打、語音、Write、Spell、重新開始。

單選可有 2 或 4 個答案。長答案可換行；當次畫面也會採雙欄。錯誤選項橘色框與叉號，正確選項綠色虛線框與勾號；其他選項淡化。答對顯示綠色結果、自動切下一題；答錯停留正解並要求繼續，可按鍵繼續。題目前方可顯示再次嘗試狀態。Write 的錯誤結果顯示題目、原答案、正解、手動認定正確與按鍵繼續。

官方 Learn 說明支持依表現調整題型／練習路徑，亦支持題型和方向設定；智慧批改有嚴格、適中、寬鬆，錯誤後可要求重打。[Learn 說明](https://help.quizlet.com/hc/en-au/articles/360030986971-Studying-with-Learn)、[智慧批改](https://help.quizlet.com/hc/en-us/articles/360048313652-Using-smart-grading-US-/)、[學習路徑](https://help.quizlet.com/hc/en-au/articles/360048314692-Setting-up-a-study-path)。

### 7 張的實測序列

選擇記熟全部，17 張卡的上方目標顯示 **34**，分成 5 段。以 A–Q 代稱卡片：

| 作答序號 | 題目 | 結果 | 後續 |
| --- | --- | --- | --- |
| 1 | A | 錯 | 沒有立刻重複 A |
| 2 | B | 對 | 下一個新單字 |
| 3 | C | 不知道 | 顯示正解並等待繼續 |
| 4–7 | D、E、F、G | 對 | 七個不同單字已問過，但沒有結算 |
| 8 | A | 對 | 提示再次嘗試 |
| 9 | C | 對 | 結算本輪 |
| 結算 | A–G | 7 個熟悉 | 顯示 7／34、21%、本輪全部單字、星號與朗讀 |
| 下一輪首題 | H | 單選 | 引入第 8 個單字，沒有立刻對 A 開書寫題 |
| 下一輪第 2 題 | I | 單選 | 答對後上方進度 9／34 |

所以「每七次作答就結算」不符合這次實測。七個新單字中答錯兩題，本輪共有九次作答。已經問完的錯題在本輪補對，才進入下一輪。不能從單次測試推論所有字卡集與帳戶都固定七張；Teah 預設七張並允許調整。

2021 年官方新手文章曾描述從辨識到書寫、答對兩次提高熟悉／精熟狀態，作為本版二階段設計的歷史依據。[歷史新手指南](https://quizlet.com/blog/a-beginners-guide-to-quizlet)。當次尚未實測完整 17 張到第二階段結束，書寫轉換的全部細節保留為設計推導。

### 無法確定的部分

Quizlet 2017 年技術文章描述以答題表現、時間、先前練習間距與方向等特徵估計記憶機率，使用 logistic regression；另一篇文章討論以題型調整提取難度。文章沒有提供今天完整模型係數或完整 chunk 規則，不能用 SM-2 或自設固定間隔冒稱原廠演算法。[間隔研究](https://quizlet.com/blog/spaced-repetition-for-all-cognitive-science-meets-big-data-in-a-procrastinating-world)、[題型研究](https://quizlet.com/blog/selecting-question-formats-to-maximize-the-testing-effect)。

部分實測選項似乎是合成的干擾答案；Teah 使用同一字卡集的答案做干擾選項，不複製未公開的 AI 出題模型。Quizlet 的圖片與付費訂閱限制亦不在此文字單字題庫的範圍。

## 本版排程：完整規則

### 狀態與方向

每張字卡的每個方向都有獨立 fact：`{cardId}_term` 表示看解釋回答單字，`{cardId}_definition` 表示看單字回答解釋。正反向同時練時，17 張卡有 34 個 fact，記熟全部的進度目標為 68。

| stage | 狀態 | 下一題的首選（啟用單選＋書寫） |
| --- | --- | --- |
| 0 | 未學習／再學習 | 單選辨識；多個合法答案可出複選 |
| 1 | 正在學習 | 書寫提取 |
| 2 | 已精熟 | 不在普通未完成佇列；可選到期複習 |

一次有效答對：`stage = min(2, stage + 1)`；答錯／不知道：`stage = 0`，streak 歸零。不是看過答案或重打就晉級。已經看過的起始設定／同方向 Flashcards 已知分類可把尚無 Learn fact 的卡從 stage 1 開始；已有同 revision 的 Learn fact 優先，不會覆蓋真實錯題。

快速熟悉的目標 stage 1，記熟全部的目標 stage 2。只啟用單選時第二次亦為單選；只啟用書寫時從第一輪即為書寫。只有一張卡或找不到不歧義的干擾項時用書寫／自評字卡，避免生成不可能有唯一正解的單選。

### 選取與固定小組

1. 依設定選全部、星號、未精熟、到期；加入正面／反面 fact。打亂只建立此次 session 的固定排序，不在每次重畫面時洗牌。
2. 建立下一個 active 小組時：先較低 stage，再較低 recall priority，再 session 排序；取前 7 個（設定可為 5／7／10／15）。因此未學習的新單字優先於上一輪已熟悉的單字，符合 H 的實測。
3. **每個 fact 的本輪目標在組建立時固定**：`chunkGoals[key] = min(finalGoal, stage + 1)`。答錯後仍須追到這個目標；不因答錯把目標降低。
4. 選題只從本組仍低於自身目標的 fact 取。優先最久未在本次 session 出現的項目。錯題盡量隔兩個其他題目再出現（ordinal 差至少 3）；其他題目差至少 2。
5. 有其他選項時避免連續問同一題。若只剩一個錯題或小組太小，放寬間隔，確保能完成，不用填充已完成題製造假間距。
6. 本組全部達成其固定目標才結算；作答次數可以大於七。全部範圍已達最終目標時直接完成。
7. 按繼續下一輪後才建立新小組。本輪錯題曾降為 stage 0，若本輪目標是 2，需補一次辨識，再一次提取。

用於同 stage 排序的 Teah 公式：

```text
elapsedDays = max(0, now - lastAt) / 86400000
stability = max(1, intervalDays)
recall = stage == 0 ? 0 : exp(-elapsedDays / stability) * (stage == 1 ? 0.55 : 0.9)
priority = recall - min(0.25, wrongCount * 0.05)
```

這是可解釋的排序近似，不是訓練得到的預測機率。stage 是第一排序條件，priority 用來同階段內排序。錯誤次數會增加優先度。

### 跨日複習

stage 2 答對後更新間隔：`min(90, max(1, 舊間隔 × 2, 距上次作答天數 × 2))`，`dueAt = now + intervalDays × 1日`。stage 0／1 間隔為 0。到期範圍從 stage 1 提取一遍；答錯重新學習。

同一次 session 的題間距與跨日 dueAt 是兩個不同概念。當天 Learn 並不等待 dueAt 才補錯題，也沒有背景推送提醒。所有間隔係數是 Teah 參數。

### 批改與干擾答案

- 嚴格：NFKC、大小寫、空白與基本標點正規化，接受已設定替代答案；數字、大小於、正負、斜線、單位等保持重要性。
- 適中：以上加上英文答案一處編輯差異／重音差異；限至少五字元的英文文字，不對數字與運算式套用模糊批改。
- 寬鬆：先本地精確／替代答案檢查，再將本題、標準答案、替代答案與作答交給既有 Gemini 整合判斷等義。12 秒逾時或不可用時保留嚴格結果，可手動更正。設定中清楚揭露傳送對象；不是 Quizlet 的智慧批改模型。
- 選項先排除重複答案、正解替代答案、相同提示的歧義卡；隨機選至多三個同組干擾答案，合計 2–4 選項。
- 複選適用同提示／替代答案有多個有效答案；選取集合須完全相符，少選、多選都錯；不把其中一個同義答案當作錯誤選項。
- 手動更正以 `override` 指向原答題 event，重新投影；原作答只計一次，錯誤計數會還原。
- 重打正解產生 `repair`，只允許離開錯誤畫面，不改熟悉程度、不增加一次答對；將來的提取仍會再次出現。

## 進度、畫面與動畫

- Learn 進度是 `sum(min(stage, goal)) / (fact數 × goal)`，不是答題次數。17 張、每張兩階段目標 34；7 張 stage 1 是 7／34 ≈ 21%。答錯後回到 stage 0，進度可能下降。
- 頂部段式進度條每段對應一組的進度單位，填滿有 transition；大量字卡最多顯示 24 段，仍顯示真實總目標，避免 4000 個小格擠破手機畫面。
- 同時顯示輪次、本組完成數、已精熟數；結算頁顯示環狀百分比、未學習／正在學習／已精熟、本輪答對／答錯、錯題與本輪全部單字。
- 題目採置中白底卡片與紫色操作、短選項雙欄、長選項單欄；手機自動單欄。
- 答對選項綠底、勾號、淡化其他選項、950 ms 後自動下一題；答錯橘框叉號、綠虛線正解、停留等待繼續。書寫顯示原答案與正解，支援重打與手動更正。
- 單選鍵盤 1–4；書寫 Enter 提交；錯誤且完成訂正後可用一般字元鍵／Enter／Space 繼續；輸入欄與對話框不攔截此快捷鍵。
- 可選音效、題目朗讀；Spell 自動播放答案，提供再播放；語音使用瀏覽器 speechSynthesis，語言依字卡設定。
- 支援深色模式、觸控滑動、focus-visible、aria 狀態／進度、減少動態效果。頁面切換取消自動前進，避免使用者不在頁面時偷偷作答。

## Firebase Realtime Database 架構

```text
/flashcard/{uid}
  /sets/{deckId}
    id, title, description, termLanguage, definitionLanguage
    revision, createdAt, updatedAt, deletedAt?
    /cards/{index}
      id, revision, term, definition
      termAliases[], definitionAliases[]
    /operations/{outboxId}: true
  /study/{deckId}
    /events/{eventId}
      id, kind, at
      cardId?, revision?, direction?, correct?, response?, type?
      sessionId?, generation?, ordinal?, initialStage?, responseTimeMs?
      originalId?    # override
      value?         # star
    /summary
      generation, correct, wrong
      /facts/{cardId_direction}
        stage, correct, wrong, streak, lastAt, lastOrdinal
        interval, dueAt, revision
      /flash/{cardId_direction}: known, revision, at
      /stars/{cardId}: boolean
    /sessions/learn
      id, deckId, deckRevision, generation, options
      scope[], order[], facts{}, active[], chunkGoals{}
      ordinal, round, chunk, chunkTarget, roundAnswers[]
      current, feedback, checkpoint, completed, createdAt, updatedAt
    /sessions/flash
      id, deckId, deckRevision, options, order[], index, ratings{}
      flipped, playing, completed, updatedAt
```

`kind` 有 answer／flash／star／reset／override／repair。每次事件 UUID 是重試去重鍵。summary 從 events 以 `(at, id)` 排序重播，不把加一計數直接覆蓋回 Firebase。重送同 event 只記一次；亂序到達會重播成相同結果。重設產生新 generation，較舊 generation 的離線作答不能把剛重設的進度補回；星號與 Flashcards 分類獨立保留。

卡片 ID 永久穩定，拖曳不改 ID。改字面或替代答案才增加 card revision；名稱／順序不清除卡片事實。整組 deck revision 每次儲存增加，用來辨識跨裝置編輯與失效 session。刪除卡片的舊事件仍保留供匯出，畫面只投影目前有效卡片；舊 revision 的作答不能覆寫較新的 fact。

### 儲存與同步

1. 答題先持久化 IndexedDB outbox，保存成功後才顯示下一步；沒有只存 React／DOM 暫存狀態。
2. 線上送出 study transaction，把事件、摘要與 session 一起更新；event UUID 去重。set transaction 檢查 baseRevision，使用 operations 收據確保重送不重複修改。
3. transaction 前讀取 set 以處理 SDK 初次 callback 可能是 null 的情況。競態仍由 transaction 重試和 revision 檢查處理。
4. session.updatedAt 在同一裝置逐次單調增加；跨裝置採較新的 snapshot。所有事件合併，但同一模式只有一個目前續答位置，並非多人同時同步同一題的協作模式。
5. 離線讀本地快取，再疊加尚未送出的操作。online、30 秒重試與手動重新同步觸發 outbox。失敗操作保留且阻止同類操作超車，其他既有題庫操作仍能同步。
6. 其他裝置先改同一組時，顯示衝突；可另存完整本機字卡集為新集，或重新讀取雲端，避免靜默覆蓋。
7. 字卡集軟刪除，可從已刪除還原；已刪除／不存在的集忽略遲到答題，不重建字卡集。
8. 切換帳號會清空可見狀態、取消 timer、依 uid 隔離 cache/outbox；匯出我的資料與刪除帳戶包含新 namespace。

RTDB 不保存空陣列／空物件，載入 session 時補回空的 active、roundAnswers、ratings 等集合；已用真實 Emulator 和模擬 wire shape 測試。卡片最多 2000、雙向 fact 最多 4000；本版一次交易會重播該集全部事件，適合個人題庫。長期歷史量很大時應再引入伺服器摘要快照／封存；目前沒有自動刪歷史，也不宣稱具備無限事件的效能。

## Firebase Rules 套用

完整規則檔：[database.rules.example.json](../firebase/database.rules.example.json)。僅新 namespace 片段：[flashcard.rules.fragment.json](../firebase/flashcard.rules.fragment.json)。兩者不是資料庫匯出、不含私鑰。**本次已在本機 Emulator 驗證，尚未發布到正式 Firebase。** CLI 雖保有登入帳號，但正式資料庫中繼資料 API 回覆 HTTP 401／UNAUTHENTICATED，無法讀取既有規則或安全地合併發布。依本次要求提供手動貼上檔案，沒有修改正式資料。

如果正式庫沿用專案規則，可將完整規則檔貼到 Firebase Console → `stock-market-ntumed` → Realtime Database → Rules → Publish。若正式規則已有其他客製，將片段的 `rules.flashcard` 合併進現有 `rules`，並在原 `$bank` 的 read/write 排除條件加入 `$bank !== 'flashcard'`。片段不能單獨整份取代原規則，否則會移除其他功能規則。

根目錄 read/write 必須保持拒絕；較上層若直接允許全部讀寫，子節點無法再拒絕其他人的字卡。新 namespace 只允許 `auth.uid === $uid`。rules 驗證字卡／session 必填欄位、最大字面長度、索引上限、事件型別與必要欄位，拒絕修改既有事件核心值；手動 override 必須指向已有 answer。個人進度由自己的客戶端計算，不是可作考試認證的伺服器評分。

無需建立索引、Firestore collection、Storage bucket 或手動匯入初始資料；第一次儲存會建立自己的 sets/study。沿用現有 Authentication。嚴格／適中批改不用任何 AI key；寬鬆批改沿用專案既有 API_KEY／Gemini 設定，不會在此功能另外寫入金鑰。

套用規則後，開啟 Flashcard → 重新同步。先前因權限拒絕保存在裝置的資料會重送；不要先清除網站資料。先以兩個測試帳號確認互相讀不到字卡；瀏覽器畫面應顯示資料已同步。

## 檔案與驗證

| 檔案 | 職責 |
| --- | --- |
| `src/features/flashcard/model.js` | 匯入、身份／revision、批改、事件重播、chunk／排程與進度 |
| `src/features/flashcard/service.js` | uid 隔離、cache、outbox、transaction、草稿、衝突、語意批改 |
| `src/features/flashcard/view.js` | 集合／編輯、匯入／匯出、Flashcards、Learn、動畫與鍵盤 |
| `styles/flashcard.css` | 白底／深色／手機／減少動畫等呈現 |
| `tests/flashcard.test.js` | 演演算法與實測序列回歸、重播、方向、批改與歧義 |
| `tests/flashcard-browser.mjs` | 完整實際操作流程，後端攔截、不接觸正式庫 |
| `tests/flashcard-edge-browser.mjs` | 空集合、複選、語意、Spell、衝突、2000 卡手機 |
| `tests/rules.emulator.mjs` | 真實 Firebase Emulator 權限／驗證／transaction |

```sh
npm test
npm run check
npm run build
npm run dev
# 另一個終端機，既有 Chrome 或 CHROME_PATH
npm run test:vocabulary
npm run test:vocabulary:edge
npm run test:rules
```

Rules 測試使用 demo 專案。Java 21+ 使用 Firebase CLI；Java 17 可使用已下載在標準 emulator cache 的相容 Database Emulator v4，啟動獨立臨時連接埠。不會下載 JAR 或連接正式 Firebase。

驗證涵蓋：7 個單字中兩次錯誤需要九次作答才結算、優先下一組新單字、最終書寫精熟、重打不晉級、手動更正不重算、重送／亂序／新 epoch、內容修改失效、同義複選、手機／深色、續答、離線補送、軟刪復原與既有複習卡隔離。
