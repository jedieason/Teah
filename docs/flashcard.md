# Flashcard：Quizlet 研究與實作規格

初次研究與驗證日期：2026-10-03（Asia/Taipei）；學習介面依使用者截圖更新於 2026-10-04。本功能是新的私人單字題庫，入口為側邊欄 **Flashcard**。字卡功能統一使用 Flashcard；舊「複習卡」入口與頁面已移除。

## 證據範圍

使用 Quizlet 官方說明、官方技術文章，以及公開字卡集的桌面版實際操作。實測字卡集為 [STAT 121: Lesson 29，17 張](https://quizlet.com/590765484/stat-121-lesson-29-flash-cards/)。實測涵蓋 Flashcards、Learn 的完整 17 張辨識／書寫交替、跨輪錯題回問、完成頁與持續練習、選擇題的答對／答錯／不知道、重試與結算、完整選項、Write 錯誤結果。建立頁起初要求登入，後續重新開啟遇到人工驗證；未操作驗證，因此匯入／建立／編輯以官方文件為依據，沒有冒稱已完成登入後全流程實測。

另開啟 [Basic Chinese Fruits and Vegetables Vocabulary for Beginners，19 張](https://quizlet.com/1169189467/basic-chinese-fruits-and-vegetables-vocabulary-for-beginners-flash-cards/)，確認其中的中文／英文短單字、拼音、句子與重複單字。進入 Learn 時出現 Press & Hold 人工驗證，尚未取得完成驗證的同意；沒有以這個集合宣稱已核對短單字的 Learn 排題或提示規則。Write／Spell 的完整排程補充以下官方文件，仍沒有完成原站兩種模式的全程對照。

使用者後續提供 Quizlet 建立字卡集與 Import 畫面截圖，補足匯入介面的直接視覺依據：建立／編輯頁的 `＋ Import`、全畫面貼上欄、兩組直式 radio、常駐自訂欄、預覽筆數、底部取消／匯入。這些截圖能確認配置與選項，不能證明分隔符解析的所有邊界行為。

Quizlet 未公開當前 Learn 完整排程程式、模型權重、所有帳戶版本與實驗分組。本版重現可觀察的主要學習流程，使用可檢查的 Teah 排程，不宣稱取得 Quizlet 的專有演算法或達成每一帳戶版本的像素級一致。

以下分為：**文件確認**、**當次實測**、**Teah 設計**。歷史文章只能支持其發表時的產品／研究方向。

## 匯入與編輯

| 功能 | 研究依據 | 本版行為 |
| --- | --- | --- |
| 批次貼上 | 官方說明＋使用者截圖 | `＋ Import` 開啟全畫面貼上；單字與解釋選 Tab／Comma／自訂，字卡間選換行／分號／自訂；dash 可在自訂填 `-` |
| 自訂符號 | 官方建立指南 | 兩種分隔符可分別自訂；可用 `::` 與 `||`，也支援文字 `\\t`、`\\n` |
| 預覽 | 官方建立指南＋使用者截圖 | 立即顯示全部解析字卡、筆數、格式問題與重複數；確認後加入現有字卡，並聚焦第一張新卡供編輯 |
| 編輯 | 官方建立／編輯說明 | 兩欄單字／解釋、語言、拖曳、上下移、插入下一張、刪除與復原、交換兩欄 |
| 新增 | 官方建立／編輯說明 | 最後一張解釋按 Tab 可新增下一張，亦可按新增字卡 |
| 格式 | 官方建立說明 | 粗體、斜體、底線、標示；透過安全 DOM 呈現，HTML 作為文字 |
| 草稿 | 官方建立說明 | 停止輸入 350 ms 後存在此裝置 IndexedDB；回到編輯可恢復；正式儲存後清除草稿 |
| 替代答案 | Teah 設計 | 每面最多 12 個，每行一個；用於書寫批改與複選 |
| 匯出 | Teah 設計 | 使用相同分隔符控制下載文字檔 |

來源：[官方匯入說明](https://help.quizlet.com/hc/en-us/articles/360029977151-Creating-sets-by-importing-content)、[建立指南](https://quizlet.com/blog/how-to-create-the-best-quizlet-sets)、[建立字卡集](https://help.quizlet.com/hc/en-us/articles/360029780752-Creating-study-sets/)、[編輯字卡集](https://help.quizlet.com/hc/en-au/articles/360030212131-Editing-sets)。

Import 預設為 Tab／換行，適用從 Excel／Google Sheets 複製兩欄資料。自訂欄一直可見，聚焦或輸入即選取自訂 radio；例如 `::`／`||`，或以 `-` 代替內建 Tab。底部操作列固定顯示取消／匯入；空白、格式問題或加上現有卡超過 2000 張時停用匯入。取消／Escape／關閉只離開貼上介面，不修改原編輯內容；確認時略過原本的空白編輯列、保留原有非空卡與順序，再追加新卡。手機仍顯示兩組分隔符與可見底部操作列，完整預覽由中間區域捲動。

建立／儲存時，缺少名稱、全部字卡空白，或已填一面的字卡缺少另一面，會顯示紅色警示、標示對應欄位並聚焦第一個缺漏處；補齊後即清除。未使用的全空白編輯列仍可略過，說明保持選填。草稿自動保存與欄位警示分開，不會以草稿保存訊息覆蓋警示。單字與解釋語言均可選馬來文（`ms-MY`），沿用既有語言欄位儲存，無須變更 Firebase 規則。

可直接貼入的例子：

```text
apple,蘋果
banana,香蕉
pear,梨
```

設定：單字與解釋「Comma」，字卡與字卡「換行」。從試算表複製兩欄時選 Tab／換行。多行解釋可使用自訂字卡分隔符：

```text
apple::紅色或綠色
水果||banana::黃色水果
```

設定：單字 `::`、字卡 `||`。解析每列第一個單字分隔符，後面的相同符號保留於解釋；空列略過，CRLF／CR 正規化成 LF、移除 BOM。這是分隔符貼上工具，不是帶引號跳脫的 RFC CSV 解析器。分隔符本身出現在內容時需換符號。重複卡保留並提示。缺少一面會阻止匯入；分隔符最多 20 字元、貼上最多 4,000,000 字元、每組最多 2000 張、每面最多 4000 字元。這些上限是 Teah 的限制。

## Flashcards

官方說明確認可翻面、切換正面、自動播放、打亂、標星號與分類為知道／還在學習。當次桌面畫面預設關閉追蹤進度；開啟才出現分類操作。[官方 Flashcards 說明](https://help.quizlet.com/hc/en-us/articles/360030988091-Studying-with-Flashcards)。

本版：

- 預設顯示單字正面，追蹤進度關閉；卡片下方可直接開啟。正面也可改成解釋。
- 卡片點擊或空白鍵翻面；3D rotateX、480 ms。兩面都有可讀內容，背面隱藏時設 aria-hidden。
- 開啟分類：左鍵／左滑為還在學習，右鍵／右滑為知道；桌面分類卡片向對應方向移出，210 ms 後切換。沒有追蹤時左右鍵只換卡。
- 手機（寬度不超過 700 px）保留原本張數／集合名稱的上下排列，兩種學習計數放在整組標題左右；下方換卡／分類按鈕隱藏，使用左右滑動。卡片跟隨手指平移與傾斜，分類時顯示橘／綠邊框與狀態；滑動超過卡片寬度 24%（最少 60、最多 110 px）才送出，280 ms 滑出並露出下一張。短滑動／取消回彈，垂直手勢保留長文字捲動；減少動態效果時仍可滑動分類。
- 上一張／下一張、Backspace 回上一張、打亂、自動播放（每面 2.2 秒）、語音與星號。
- 每次翻面／換卡／分類均保存；重新整理回到同一張和同一面。自動播放不會在重新載入時自行啟動。
- 結束時列出兩種分類數，可只重練本輪還在學習的卡；最後的分類同時保存在歷史，Learn 可把同方向「知道」的卡從熟悉階段開始。
- Flashcards 的分類紀錄與 Learn 答題紀錄分開；翻面、瀏覽不會算成一次答對。
- 切換頁面、隱藏分頁、開啟設定會停止播放／朗讀。減少動態效果設定關閉過場動畫。

動畫時間與鍵盤配置為 Teah 實作參數，沒有把人工觀察當成 Quizlet 原始毫秒數。

## Learn 的實際觀察

### 題型與選項

當次快速選項預設啟用單選、複選、書寫；字卡題型關閉。快速選項另有打亂、只學星號、音效。完整選項有作答方向、圖片、三種書寫批改、重打、語音、Write、Spell、重新開始。

單選可有 2 或 4 個答案。長答案可換行；當次畫面也會採雙欄。錯誤選項橘色框與叉號，正確選項綠色虛線框與勾號；其他選項淡化。答對顯示綠色結果、自動切下一題；答錯停留正解並要求繼續，可按鍵繼續。最近一次答錯的題目前方顯示再次嘗試狀態；歷史曾答錯但後來已答對的卡不因此一直顯示。Write 的錯誤結果顯示題目、原答案、正解、手動認定正確與按鍵繼續。書寫題另有特殊字元按鈕與大小寫切換；部分較長、非 Yes／No 的答案提供 Show hint。

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

2021 年官方新手文章曾描述從辨識到書寫、答對兩次提高熟悉／精熟狀態，作為本版二階段設計的歷史依據。[歷史新手指南](https://quizlet.com/blog/a-beginners-guide-to-quizlet)。後續續答實測確認第 10 個單字 J 辨識後，即回到 A 書寫；並未先問完所有 17 個新單字。批次大小 10 是這個公開集的觀察，不能推論全部帳戶版本。

### 後續書寫與混合回合實測

原頁關閉後，重新開啟同一公開集，進度恢復 9／34，當前是 J 辨識。這次畫面結算只列出重新開啟後的題目，**不能把 H、I 與續答後的 J–F 當作同一個完整回合**。

| 續答序列 | 結果與進度 | 觀察 |
| --- | --- | --- |
| J 辨識 | 對，10／34 | Yes／No 兩選項；字卡原答案仍是完整說明 |
| A 書寫 | 輸入 `wrong` 卻被寬鬆批改接受 | 停留原答案與正解，提供 I was incorrect；沒有自動切題 |
| 手動改為錯 | 仍 10／34，下一題 B 書寫 | 保留 A 的辨識信用，沒有降到 9 |
| B、C、D、E、F 書寫 | 對，逐次到 15／34 | J、A–F 共七個題目即結算；沒有在本輪補問 A |
| 下一輪 A | 書寫，Let's try again | 上輪錯題優先；按不知道後仍保留 15／34 |
| G、H、I、J 書寫，K 辨識 | 對，到 20／34 | 問完前十張的提取後，才引入 K |
| L 辨識 | 不知道，20／34 | A、G–L 共七題即結算；混合回合的 L 也沒有在本輪重試 |
| 再下一輪 | A 書寫，接著 L 辨識，再 M–Q 辨識 | A、L、M–Q 七題結算，27／34、79% |
| 最後一輪 | K–Q 書寫全部答對 | 進入已學完所有單字的完成頁 |
| 完成後 Continue practicing | 第一題 J 書寫，沒有進度條 | J 按不知道後問 K；不只挑選本次有錯的 A／C／L |
| 返回集合頁 | A、J 為 Still learning，其他 15 為 Mastered | 本次完成的信用與精熟分類並非同一數值；J 在持續練習答錯會重新列為學習中 |

辨識初輪的兩次錯誤讓七張卡延長到九次作答；後續混合回合則會將錯題帶到下一輪。這是目前觀察到的差別，不能將「每輪全部補對」泛化成 Learn 的單一規則。Teah 為純辨識回合與混合／提取回合採不同結束條件；這一泛化仍是實作選擇。

### 書寫提示的實測

M 的短公式提示為 `0.01 < ______ ___`；N 的長句提示為 `Reject H0 and conclude that those who drink no beer have a shorter...`。使用提示後答對仍讓進度增加，沒有被當成一次答錯。兩字元答案 `17` 與 Yes 開頭的二元說明在這次畫面沒有提示按鈕。

Teah 的提示：少於四個字元／二元說明不顯示；短答案揭露前約三分之一，剩餘字母／數字改底線；超過 80 字元的長答案顯示前半段至完整單字，加省略號。這些界線與一般化遮罩規則是實作推導，目前只有上述兩個結果可直接核對，並非已知的原廠提示程式。

特殊字元從同作答方向的字卡內容收集希臘字母、重音字母與常用數學符號，最多 24 個，可切換大小寫；點擊插入目前游標／選取位置。顯示提示會保存 session 的提示與未送出文字，不增加答題 event；同一題標星號重畫面也保留輸入。

### 無法確定的部分

Quizlet 2017 年技術文章描述以答題表現、時間、先前練習間距與方向等特徵估計記憶機率，使用 logistic regression；另一篇文章討論以題型調整提取難度。文章沒有提供今天完整模型係數或完整 chunk 規則，不能用 SM-2 或自設固定間隔冒稱原廠演算法。[間隔研究](https://quizlet.com/blog/spaced-repetition-for-all-cognitive-science-meets-big-data-in-a-procrastinating-world)、[題型研究](https://quizlet.com/blog/selecting-question-formats-to-maximize-the-testing-effect)。

部分實測選項似乎是合成的干擾答案；Teah 使用同一字卡集的答案做干擾選項，不複製未公開的 AI 出題模型。Quizlet 的圖片與付費訂閱限制亦不在此文字單字題庫的範圍。

## 本版排程：完整規則

### 狀態與方向

每張字卡的每個方向都有獨立 fact；`credit` 保存這個世代已取得的答對進度（0–2），`stage` 保存精熟分類，`streak` 保存連續答對次數。`{cardId}_term` 表示看解釋回答單字，`{cardId}_definition` 表示看單字回答解釋。正反向同時練時，17 張卡有 34 個 fact，記熟全部的進度目標為 68。

| stage | 狀態 | 下一題的首選（啟用單選＋書寫） |
| --- | --- | --- |
| 0 | 未學習 | 單選辨識；多個合法答案可出複選 |
| 1 | 正在學習 | 書寫提取 |
| 2 | 已精熟 | 不在普通未完成佇列；可選到期複習 |

一次有效答對：`credit = min(2, credit + 1)`、`streak += 1`。答錯／不知道：credit 保留、streak 歸零。stage 的推導為：credit 0 → stage 0；credit 非零且 streak 少於 2 → stage 1；連續答對至少兩次 → stage 2。未學習的辨識錯題仍為 0；熟悉的書寫錯題保持 1，下一次仍可書寫。不是看過答案或重打就晉級。已經看過的起始設定／同方向 Flashcards 已知分類可把尚無 Learn fact 的卡從 stage 1 開始；已有同 revision 的 Learn fact 優先，不會覆蓋真實錯題。

快速熟悉的進度目標 credit 1，記熟全部的目標 credit 2；完成與所有卡達 stage 2 不必同時發生。A 在辨識答對後書寫兩次失敗、後來書寫答對一次；本次信用已到 2，但連續答對只有 1，仍屬於學習中。兩次連續提取才精熟是與本次觀察及歷史說明一致的設計推導，並非所有版本的私有原始碼。只啟用單選時第二次亦為單選；只啟用書寫時從第一輪即為書寫。只有一張卡或找不到不歧義的干擾項時用書寫／自評字卡（Yes／No 類答案仍可有兩個選項），避免生成不可能有唯一正解的單選。

### 辨識批次、回合與補錯

1. 依設定選全部、星號、未精熟、到期；加入正面／反面 fact。打亂只建立此次 session 的固定排序，不在重畫面時洗牌。
2. 依固定排序每 10 個 fact 建立一個學習批次：先為 credit 0 安排目標 1 的辨識 pass，再為 credit 少於 2 的 fact 安排目標 2 的提取 pass。前十張完成各自的提取機會後，才接下一批辨識。快速熟悉只有目標 1；只有某一題型時，以該題型作答。
3. 獨立的 round 預設保留 7 個問題位置（設定可為 5／7／10／15），可以跨越辨識與提取 pass。`flowQueue` 保存尚未安排的 `{key,target}`；`retryQueue` 保存未達該次目標的錯題；`chunkGoals` 保存本輪每題的目標。這些集合不等同於十張的學習批次。
4. 下一輪先安排 retryQueue，再安排 flowQueue；同一輪不保留同一 fact 的辨識與提取兩個位置。已達到 target 的預排題直接略過，避免錯題補對後又被重複算成新任務。
5. 純辨識 round（所有目標為 1）在所有保留位置達標後結算；錯題在其他未問題後再問。因此 A／C 失敗的初輪仍可重現九次作答後 7／34 的結果。
6. 混合／提取 round 每個保留位置作答一次即結算，不要求所有位置當輪達標。未達標者下一輪優先，保持書寫／辨識難度；`roundSeen` 區分已作答與已晉級。
7. 有其他未問題時先問其他題；重問盡量隔兩個其他問題（ordinal 差至少 3），只有一張卡時放寬以確保可完成。沒有放入已精熟填充題製造假間距。
8. 全範圍 credit 達本次目標時直接完成，stage 可能仍有學習中的卡。修正判分只重算當題，尚未繼續時不預先改補錯佇列；繼續／下一輪時才使用最後結果。

**參數來源**：10 個辨識後進入提取、書寫失敗保持信用、混合回合錯題優先跨輪回問，均有上述實測。純辨識回合一律補到目標、所有集合都用固定 10 個批次、可自訂 round 大小，以及最小題間距，是 Teah 為未觀察情境採用的明確泛化，尚不能等同 Quizlet 的私有排程。此版不再以自設指數 recall 公式宣稱近似目前 Learn 的選題。

### 完成後的持續練習

完成頁提供繼續練習、返回集、重新開始 Learn。繼續練習沒有完成進度條，不會因全部卡 credit 已達 2 而立刻結束；使用原方向／題型繼續提取，答案事件仍更新 streak、stage 與到期狀態。重新開始產生新世代，保留歷史事件及 Flashcards 分類，但新 Learn 不套用該分類的初始信用。

Teah 的持續模式每循環打亂此範圍的所有 fact，錯題插入約兩題之後，小集合放寬；有其他卡時避免立即重問同一張。沒有每七題結算、沒有終止條件；使用者可從上方返回。session 只保留最近 20 次練習答案，完整歷史仍在 events。首次題 J、沒有進度條與錯誤後下一題 K 是實測；整個循環隨機規則、錯題間距與 20 次窗口是 Teah 設計，尚未取得 Quizlet 持續模式的完整順序。

### Write 與 Spell：獨立的本次進度

[官方 Write 說明](https://help.quizlet.com/hc/en-us/articles/360030990531-Studying-with-Write-mode)確認第一輪先作答集合內每一題，後續輪次針對錯題，完成需要每題答對兩次；不知道會揭露正解，可手動認定原答案正確。它不等同於 Learn 只勾書寫題，也不能套用本版 Learn 的七題／十張排程。

Teah 的 `options.activity` 為 `learn`、`write` 或 `spell`；三者從同一 Learn 設定入口啟動，當前 session 仍保存在 `/sessions/learn`。Write／Spell 另有 `writeCredits[key]`（0–2），開始一次新練習時歸零，不套用既有 Learn credit、已看過或 Flashcards 知道分類。每次答題仍寫入不可重複的 answer event，更新集合的總體 facts；本次完成與總體精熟分開。

- **Write 第一輪**：整個所選範圍依本次排序各作答一次，錯題在這輪不立刻再問，也沒有七題小結。17 張含兩題錯誤時，第 17 次作答才結算，進度為 15／34。
- **Write 後續輪**：上輪曾錯題先排，再排尚未取得兩次正確的其他題，每題這輪作答一次。沿用例子，第二輪全對到 32／34，第三輪只剩原本兩張；答對後 34／34 完成。錯誤不抹掉本次已取得的一次正確。
- **改分與訂正**：手動改分從 `beforeWriteCredit` 重算當題信用，可以雙向修正，不增加 ordinal。重打正解只產生 repair，不增加 Write／Spell 信用；重新整理恢復原題、提示、結果與本次信用。
- **Write 不知道**：顯示正解後等待繼續。這與實測一般 Learn 的書寫不知道僅顯示 Skipped 有別。
- **重新開始 Write／Spell**：只建立這個模式的新 session 信用，不重設整個 Learn 歷史世代。

[官方 Spell 說明](https://help.quizlet.com/hc/en-au/articles/360030645752-Studying-with-Spell-mode)確認聽音輸入、每字正確兩次、拼錯字元標示、逐字拼讀與重試，並可選慢速語音。Teah 採嚴格拼字，不用語意批改接受同義詞；拼錯後顯示輸入與標準答案的字元差異、自動逐字拼讀，按重試回到同一字。答對一次後問其他字，之後完整再走尚未答對兩次者；全部達兩次才顯示完成結果。語音速度可為一般 0.9 或慢速 0.65，使用瀏覽器語音與所選答案語言；沒有把這些速度當成 Quizlet 原始參數。

依使用者後續要求，Spell 題目框顯示另一面的文字，不再用「聽寫」取代提示，也不另設「播放單字」按鈕。例如單字 `apple`／解釋 `蘋果`、作答方向「答單字」時，畫面顯示 `蘋果`，自動播放與右上角喇叭播放 `apple`；反向時顯示 `apple` 並播放 `蘋果`。錯字標示、逐字拼讀與重試沿用原本流程。

朗讀會以 `getVoices()` 取得裝置語音，先選完整語言代碼相符者（如 `ms-MY`），再選同語言其他地區（如 `ms-SG`）；初次清單尚未載入時等待 `voiceschanged`，上限一秒。畫面切換會取消等待及播放，避免前一題晚到的語音。若沒有馬來文語音會顯示資料狀態，請使用者在系統啟用馬來文；不會使用英語語音替代。這是裝置語音支援，不保證所有瀏覽器／系統都內建馬來文。[MDN getVoices](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices)、[語音語言代碼](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/lang)。

2026-10-03 本機 Chrome 原生語音檢查取得 `Amira`／`ms-MY`，由實際 Spell 喇叭播放 `epal`，確認語音發出 `start` 與 `end`，沒有播放錯誤。瀏覽器回歸另以受控語音清單驗證完整地區優先、同語言地區備選、延遲載入及缺少馬來文時的狀態。

**尚屬實作推導**：Write 第二輪錯題與其他題的精確排序、是否共用先前模式的信用、Spell 的完整 pass 順序及同題立即重試方式，官方說明沒有足夠細節，未完成原站實測。上面的完整規則是可以重現、儲存與測試的 Teah 選擇，不能稱為原廠私有排程。Spell 只接受聽到的標準答案，不把另一個同義詞當成正確拼字；一般書寫仍接受字卡替代答案。拼字差異以 Unicode 字元的有界編輯距離對齊（兩面各不超過 256 字元），超過時標示整段差異以限制記憶體使用；這也不是原廠差異演算法。

### 跨日複習

stage 2 答對後更新間隔：`min(90, max(1, 舊間隔 × 2, 距上次作答天數 × 2))`，`dueAt = now + intervalDays × 1日`。stage 0／1 間隔為 0。到期範圍為本次 session 設定 stage／credit 1 再提取一遍；尚未精熟範圍也會為已取得兩次信用但尚未精熟的卡建立一次新的提取機會；答錯保留 stage 1，稍後再提取。

同一次 session 的題間距與跨日 dueAt 是兩個不同概念。當天 Learn 並不等待 dueAt 才補錯題，也沒有背景推送提醒。所有間隔係數是 Teah 參數。

### 批改與干擾答案

- 嚴格：NFKC、大小寫、空白與基本標點正規化，接受已設定替代答案；數字、大小於、正負、斜線、單位等保持重要性。
- 自動：依兩面語言、集合張數與此裝置的預設語言，選嚴格／適中／寬鬆。兩面不同語言，以及中文、日文、數學等一律嚴格；同語言且至少三張、英文／法文／德文／西文與預設語言相同時寬鬆，其他同語言用適中。依據 [官方批改選項](https://help.quizlet.com/hc/en-us/articles/360048313652-Using-grading-options-US)。Quizlet 使用帳戶預設語言，Teah 使用 `navigator.language`，此差別仍待帳戶實測。手動選擇寬鬆可用於其他語言，這是 Teah 的延伸，不是原站支援範圍。
- 適中：以上加上拉丁字母答案的重音差異，以及至少三字元答案的一處增／漏字；同長度替換字母限至少五字元。數字與運算式不套用模糊批改。這些精確門檻是 Teah 的保守規則，官方只描述輕微重音與漏字，沒有公開判分程式。
- 寬鬆：先本地精確／替代答案檢查，再將本題、標準答案、替代答案與作答交給既有 Gemini 整合判斷等義。12 秒逾時或不可用時保留嚴格結果，可手動更正。設定中清楚揭露傳送對象；不是 Quizlet 的智慧批改模型。
- 選項先排除重複答案、正解替代答案、相同提示的歧義卡；隨機選至多三個同組干擾答案，合計 2–4 選項。
- 複選適用同提示／替代答案有多個有效答案；選取集合須完全相符，少選、多選都錯；不把其中一個同義答案當作錯誤選項。
- 寬鬆接受等義答案後保留作答、正解、繼續與「我的答案其實錯誤」，等待確認，不套用答對自動前進。
- 手動更正以 `override` 指向原答題 event，可 true／false 雙向更正，依最後有效更正重新投影；原作答只計一次，答對／答錯計數同步還原。
- 重打正解產生 `repair`，只允許離開錯誤畫面，不改熟悉程度、不增加一次答對；將來的提取仍會再次出現。

## 進度、畫面與動畫

- Learn 進度是 `sum(min(credit, goal)) / (fact數 × goal)`，不是答題次數或精熟數。17 張、每張兩階段目標 34；7 張 credit 1 是 7／34 ≈ 21%。未精熟題答錯不會失去先前的辨識信用。結果畫面先保持作答前的進度，繼續到下一題才移動標記。
- 頂部段式進度條每段對應一組的進度單位，填滿有 transition；大量字卡最多顯示 24 段，仍顯示真實總目標，避免 4000 個小格擠破手機畫面。
- 同時顯示輪次、本組完成數、已精熟數；結算頁顯示環狀百分比、未學習／正在學習／已精熟、本輪答對／答錯、錯題與本輪全部單字。
- 題目採置中白底卡片與紫色操作、短選項雙欄、長選項單欄；手機自動單欄。
- 答對選項綠底、勾號、淡化其他選項、950 ms 後自動下一題（等義接受須等待確認）；答錯橘框叉號、綠虛線正解、停留等待繼續。書寫顯示原答案與正解，支援重打與手動更正。
- 單選鍵盤 1–4；書寫 Enter 提交；錯誤且完成訂正後可用一般字元鍵／Enter／Space 繼續；輸入欄與對話框不攔截此快捷鍵。
- 可選音效、題目朗讀與答案朗讀；Spell 自動播放答案，提供再播放；語音使用瀏覽器 speechSynthesis，語言依字卡設定。書寫提示、特殊字元與大小寫切換不算作答；空白輸入時確認按鈕停用。
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
        stage, credit, correct, wrong, streak, lastAt, lastOrdinal
        interval, dueAt, revision
      /flash/{cardId_direction}: known, revision, at
      /stars/{cardId}: boolean
    /sessions/learn
      id, deckId, deckRevision, generation, options
      version, scope[], order[], facts{}, active[], chunkGoals{}
      flowQueue[], retryQueue[], practiceQueue[], roundSeen[], roundRepair
      writeCredits{}, passMisses[]  # Write／Spell 本次信用與上輪錯題
      ordinal, round, chunk, chunkTarget, roundAnswers[]
      current, feedback, checkpoint, completed, createdAt, updatedAt
      # options.activity, grading, defaultLanguage, audioRate, learnTypes, audioAnswer
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

排程版本為 3；舊版 session 不顯示續答，但事件與已學習事實保留，新 session 從既有進度開始。RTDB 不保存空陣列／空物件，載入 session 時補回空的 active、roundAnswers、flowQueue、retryQueue、roundSeen、practiceQueue、ratings 等集合；已用真實 Emulator 和模擬 wire shape 測試。卡片最多 2000、雙向 fact 最多 4000；本版一次交易會重播該集全部事件，適合個人題庫。長期歷史量很大時應再引入伺服器摘要快照／封存；目前沒有自動刪歷史，也不宣稱具備無限事件的效能。

## Firebase Rules 套用

完整規則檔：[database.rules.example.json](../firebase/database.rules.example.json)。僅新 namespace 片段：[flashcard.rules.fragment.json](../firebase/flashcard.rules.fragment.json)。兩者不是資料庫匯出、不含私鑰。**本次已在本機 Emulator 驗證，尚未發布到正式 Firebase。** CLI 雖保有登入帳號，但正式資料庫中繼資料 API 回覆 HTTP 401／UNAUTHENTICATED，無法讀取既有規則或安全地合併發布。依本次要求提供手動貼上檔案，沒有修改正式資料。

如果正式庫沿用專案規則，可將完整規則檔貼到 Firebase Console → `stock-market-ntumed` → Realtime Database → Rules → Publish。若正式規則已有其他客製，將片段的 `rules.flashcard` 合併進現有 `rules`，並在原 `$bank` 的 read/write 排除條件加入 `$bank !== 'flashcard'`。片段不能單獨整份取代原規則，否則會移除其他功能規則。

根目錄 read/write 必須保持拒絕；較上層若直接允許全部讀寫，子節點無法再拒絕其他人的字卡。新 namespace 只允許 `auth.uid === $uid`。rules 驗證字卡／session 必填欄位、最大字面長度、索引上限、事件型別與必要欄位，拒絕修改既有事件核心值；手動 override 必須指向已有 answer。Write／Spell 本次信用須為 0–2 整數，activity 只允許已知模式。個人進度由自己的客戶端計算，不是可作考試認證的伺服器評分。

無需建立索引、Firestore collection、Storage bucket 或手動匯入初始資料；第一次儲存會建立自己的 sets/study。沿用現有 Authentication。嚴格／適中批改不用任何 AI key；寬鬆批改沿用專案既有 API_KEY／Gemini 設定，不會在此功能另外寫入金鑰。

套用規則後，開啟 Flashcard → 重新同步。先前因權限拒絕保存在裝置的資料會重送；不要先清除網站資料。先以兩個測試帳號確認互相讀不到字卡；同步成功後不會再顯示未同步提示。

## 檔案與驗證

| 檔案 | 職責 |
| --- | --- |
| `src/features/flashcard/model.js` | 匯入、身份／revision、批改、事件重播、chunk／排程與進度 |
| `src/features/flashcard/service.js` | uid 隔離、cache、outbox、transaction、草稿、衝突、語意批改 |
| `src/features/flashcard/view.js` | 集合／編輯、匯入／匯出、Flashcards、Learn、動畫與鍵盤 |
| `styles/flashcard.css` | 白底／深色／手機／減少動畫等呈現 |
| `tests/flashcard.test.js` | 演算法與實測序列回歸、重播、方向、批改與歧義 |
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
npm run test:vocabulary:study
npm run test:rules
```

Rules 測試使用 demo 專案。Java 21+ 使用 Firebase CLI；Java 17 可使用已下載在標準 emulator cache 的相容 Database Emulator v4，啟動獨立臨時連接埠。不會下載 JAR 或連接正式 Firebase。

驗證涵蓋：7 個單字中兩次錯誤需要九次作答才結算、十張辨識後轉提取、混合回合跨輪補錯／保留信用、完成信用與連續精熟分離、持續練習與重新開始、重打不晉級、等義接受等待確認、雙向手動更正不重算、重送／亂序／新 epoch、Write 整集首輪／本次兩次正確／不知道揭答、Spell 錯字差異／逐字朗讀／重試續答、自動批改依語言與張數選擇、內容修改失效、同義複選、書寫提示／游標字元插入／大小寫／保留未送出文字、手機／深色、續答、離線補送、軟刪復原與既有學習紀錄隔離。


## 2026-10-04：Flashcards／Learn 截圖介面

本次以使用者提供的十二張截圖為直接視覺依據，並重新核對 [官方 Flashcards 說明](https://help.quizlet.com/hc/en-us/articles/360030988091-Studying-with-Flashcards) 與 [官方 Learn 說明](https://help.quizlet.com/hc/en-us/articles/360030986971-Studying-with-Learn)。截圖能確認版面、操作與答題狀態，不提供私有排程程式；既有可檢查的 Learn 排程與保存機制繼續使用。

- 學習畫面占用完整視窗，左右置中，不留廣告欄。左上切換模式、中央顯示集合名稱與 Flashcards 張數、右上設定／離開。背景導覽在學習時設為 inert，離開後恢復。
- Flashcards 大白卡、柔和陰影、卡內編輯／朗讀／星號；下方追蹤進度、上一張／下一張或還在學習／知道了、自動播放／撤銷、打亂。沒有藍色 shortcut 橫幅、卡內重複提示或 Privacy Policy 連結。
- Flashcards 設定直接生效：追蹤、星號範圍、正面、同時顯示雙面、打亂、語音、重新開始；快捷鍵集中在可展開的設定區。顯示／音訊選項保留位置；範圍、方向或排序改變會重建本輪。
- 雙面顯示使用上下分隔；兩面可讀，不再翻面。卡內編輯只更新該張內容 revision 並保留瀏覽位置。分類可撤銷，包括最後一張；重開後仍可撤銷。用帶 originalId 與 value=false 的補償 flash 事件略過原分類，保留 immutable history，不增加 Learn 答對次數；沿用現有 Firebase 規則。
- Learn 入口先選「快速熟悉／記熟全部」，亦可開啟學習設定。練習中齒輪先顯示快速設定，再開啟完整選項；完整設定分為題型、作答方向、批改、語音，以及 Write／Spell。
- Learn 單選維持雙欄，手機單欄；答錯選項橘框、正確答案綠色虛線，答對綠色實線，其他選項淡化。不知道顯示「已略過」與正解；結果使用必要的資料狀態文字。繼續按鈕在卡片外的底部。
- 設定取消不修改已保存 session；只改語音／批改等選項時保留當前題、未送出答案與回合。改題型、方向、範圍、目標等排題選項時按既有 facts 重建練習；無題型或無可練卡片時顯示錯誤並保留舊 session。

`npm run test:vocabulary:study` 驗證桌面／手機／深色的視窗置中、雙面、即時設定保留位置、卡內編輯、分類補償與重開、模式切換、目標、選擇題錯誤／不知道、快捷鍵、設定取消／保存與空題型防護。測試攔截 Firebase，不接觸正式使用者資料。


## AI 生成字卡

- 錯題本「AI 一鍵製作字卡」先開啟生成對話框。可輸入內容範圍、風格、語言、重點與張數；留空時依所選錯題整理。未勾選時按目前篩選與排序取前 30 題；手動選取每次最多 30 題，已熟悉題目不納入。
- AI 生成入口只在錯題本，必須有待複習錯題來源；指令用於指定這些錯題的整理內容、重點與風格。
- 生成期間停留在原畫面。失敗可保留指令重試，取消或逾時不會儲存未完成內容。成功後自動寫入 `/flashcard/{uid}/sets/{id}`，才進入已填好內容的編輯頁，可修改內容後按「完成」或「建立並練習」。
- AI 直接回傳 Flashcard 的 `term`、`definition`、雙面替代答案、名稱、說明與語言。回應需通過格式、張數、字數、重複與錯題來源驗證；帶錯題素材時僅依來源整理。素材中的指令不會取代使用者的生成指令。
- 使用既有登入、Gemini 與 Flashcard 本機快取／outbox。連線或 Firebase 權限問題保留本機字卡並重送；未修改正式 Firebase 規則。
- 舊「複習卡」入口、頁面與筆記轉複習卡操作已移除；既有 `learning/{uid}/card_*`、`deck_*` 資料保留在帳戶匯出中，不再建立或顯示舊版字卡。

`npm test` 涵蓋生成格式與來源驗證；啟動 `npm run dev` 後執行 `npm run test:flashcards` 驗證生成、失敗重試、編輯、持久保存、取消及手機／深色畫面，使用假 Firebase 與假 AI 回應。


## AI 編輯字卡

Flashcard 的字卡集詳細頁與編輯頁提供「AI 編輯字卡」。輸入編輯指令，例如修正拼字、翻譯、修改語言、調整換行或粗體。AI 只編輯現有卡片，回應必須完整保留原有識別碼與張數；不增加或刪除卡片。大字卡集按張數與文字長度分批，每批逾時 90 秒，全部成功後才套用至草稿。任一批失敗或取消時不套用部分結果。

修改先保存為本機編輯草稿，使用者檢查內容後按「完成」才更新字卡集；AI 編輯本身不會建立新字卡集。沿用既有 revision 機制，內容變動後相關練習進度會依版本重建。支援的排版為換行、條列文字、粗體、斜體、底線與標示。AI 指令與既有字卡內容會送至 Gemini。
