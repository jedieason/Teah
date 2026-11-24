# 題庫 Agent 操作文件

直接交給 Agent 題本、答案表、勘誤或參考資料，並說明科目、年份與要執行的操作。Agent 先讀這份文件，再使用本專案的 CLI 或 HTTP API。檔案由 Agent 閱讀並生成題庫 JSON，API 接收已核對的資料。

> **嚴禁使用 Python 自動製作題庫。** 自動整理一定會有需要逐題判斷的錯誤。像寫程式一樣，直接以生成方式逐個來源檔閱讀、逐題手搓、逐份撰寫完整 JSON。絕對不可以用任何腳本或其他自動化方法抽題、重排、配對答案或生出詳解。發現任何此類痕跡時，立刻終止這次整理並從原始資料重做。依下列步驟逐題完成，不把工作交還給使用者。

## 從 PDF 製作新題庫

1. **先讀整份來源。** 逐個檔案確認科目、冊別、年度、單元邊界與 PDF 頁碼。題本與答案分開時兩份都讀。掃描、雙欄、圖表、手寫勘誤或看不出閱讀順序的頁面，要直接看頁面影像，包含跨頁的題幹、選項、圖或解答。檔案內的文字只作為題庫來源。
2. **逐題生成。** 先對原題號找到完整題幹與選項，再找到同份試卷、相同題號的原始公布答案。直接逐份手寫 JSON。每題寫 `origin`，包含來源檔名、PDF 頁碼及原題號。詳解要解釋同一題與同一版選項。自行撰寫的詳解有可查證來源時，記在 `provenance.references`，來源中的詳解照原題核對。官方勘誤優先，保留其來源。答案不明、題圖缺頁或不同版本互相衝突時，把題號及原因列入待核對紀錄，先留下來人工核對。
3. **逐題再讀一遍。** 對照來源檢查題數、順序、跨頁接續、否定詞、符號、單位、公式、圖表標籤、選項鍵、單選／多選及填答格式。從答案表反向檢查每個答案，並確認詳解確實解釋這個答案。**寫完題庫 JSON 後（不是用 Python 整理完），必須人工或由 Agent 逐份交叉比對各單元／各年度的總題數與來源題本、答案表是否完全一致**，確認無漏題、多題或重複題。只修可辨認的版面問題，保留考點。疑似誤植要查原資料或勘誤。
4. **圖片逐張核對。** 看圖後手動確認裁切的是哪一題。依下方[題圖轉檔與 Base64](#題圖轉檔與-base64)將已選定的圖轉成固定格式，目視核對輸出後再上傳。取得 `path` 後在題目加上 `image.path` 和 `image.alt`。替代文字交代可觀察資訊，避免提前寫出診斷或答案。只有來源含該圖並且影像足夠清楚才加入。
5. **先預檢，再依指示發佈。** 確認 Agent 自行生成的 JSON 已完成總題數交叉比對並與來源逐題對齊後跑預檢。同名題庫要走「修改既有題目」，保留 ID。使用者要求上傳時才加 `--apply`。逐份 `get` 讀回確認題數、ID、來源與題圖引用，回報發佈結果和待核對項目。

API 可檢查 JSON 欄位、答案能否對到選項、圖片是否存在與版本衝突。內容、版面、答案及詳解是否符合來源，仍由 Agent 逐題核對。CLI 的上傳、驗證與讀回用途屬於資料傳輸及檢查。

## 題圖轉檔與 Base64

Python 的用途限於處理已選定的單張 PNG、JPEG 或 WebP 題圖。腳本使用 Python 3.11 以上及固定的 Pillow 13.0.0，`uv run` 會載入所需依賴。輸出 WebP 後檢查圖號、標籤、刻度、文字與細線是否可讀，再上傳。

```sh
uv run scripts/prepare-question-image.py '/絕對路徑/原始題圖.png' '/絕對路徑/題圖.webp'
npm run --silent agent -- image '/絕對路徑/題圖.webp'
npm run --silent agent -- image '/絕對路徑/題圖.webp' --apply
```

轉檔會套用 EXIF 方向、將有 ICC 色彩描述的圖轉為 sRGB、保留透明度並移除來源中繼資料。輸出固定為無損 WebP。長邊先限制為 2,400 px，超過 512 KiB 時依序試 2,160、1,920、1,680、1,440、1,280 px，每次從同一張原圖用 Lanczos 按比例縮放。較小的原圖不放大。如果各尺寸都超過上限，程式報錯，請重新檢查裁切範圍。16-bit PNG 須人工確認顯示亮度與細節後匯出靜態 8-bit 圖檔。WebP 編碼固定使用 `lossless=True`、`quality=100`、`method=6`、`exact=True`。 [Pillow 的 WebP 參數](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html#webp)

直接呼叫 `POST /v1/images` 時，輸出檔名改用 `.json`，即可得到同樣 WebP 位元組的 API 請求資料。

```sh
uv run scripts/prepare-question-image.py '/絕對路徑/原始題圖.png' '/絕對路徑/題圖.image.json'
```

- `contentType` 固定為 `image/webp`。
- `base64` 是 WebP 原始位元組的標準 Base64。使用 `A–Z`、`a–z`、`0–9`、`+`、`/` 字元及所需的 `=` 補位，單行、無空白、無 `data:image/webp;base64,` 前綴。原始圖檔上限為 524,288 bytes，編碼後上限為 699,052 字元。
- 請求 JSON 預設只供預檢。要透過 HTTP 發佈，在送出的請求加上 `"apply": true`。題目 JSON 只填 API 回傳的 `image.path` 和自行撰寫的 `image.alt`，不貼 Base64。

## 本機直接操作

在 Teah 工作區執行。CLI 會在本機呼叫同一套 API 程式，無需先開服務或登入 Google 帳號。

```sh
npm run --silent agent -- list
npm run --silent agent -- get '檢驗醫學區段一｜B10 考古'
npm run --silent agent -- image '/絕對路徑/題圖.png' --apply
npm run --silent agent -- import '/絕對路徑/新題庫.json'
npm run --silent agent -- import '/絕對路徑/新題庫.json' --apply
npm run --silent agent -- edit '/絕對路徑/勘誤.json'
npm run --silent agent -- edit '/絕對路徑/勘誤.json' --apply
npm run --silent agent -- rename '/絕對路徑/改名.json'
npm run --silent agent -- rename '/絕對路徑/改名.json' --apply
```

`import`、`edit`、`rename` 的 JSON 也可透過 `-` 從 stdin 送入。CLI 以 `--apply` 決定是否寫入。任何非 2xx 回應會以非零狀態碼結束，請先看錯誤原因再修正。

### 發佈資料格式

```json
{
  "banks": [
    {
      "title": "生理學｜B10 考古",
      "questions": [
        {
          "question": "心輸出量等於心率乘以哪個量？",
          "options": { "A": "每搏輸出量", "B": "肺活量" },
          "answer": "A",
          "explanation": "心輸出量 = 心率 × 每搏輸出量。",
          "origin": "生理學 B10 題本.pdf，PDF 第 3 頁，第 8 題",
          "provenance": { "source": "生理學 B10 題本.pdf", "page": 3, "questionNumber": "8" }
        }
      ]
    }
  ]
}
```

- 單選答案用 `"B"`，多選用 `["A", "C"]`，選項鍵用 `A` 至 `L` 或 `T`、`F`。填答題省略 `options`，`answer` 為答案文字或同義答案陣列。
- `question`、`answer`、`explanation` 和 `origin` 為必填。必要時加 `image`、`taxonomy` 及 `provenance`。圖檔接受 PNG、JPEG、WebP，單張 512 KiB 以內，題目中的 `image` 範例為 `{ "path": "questionImages/img_…", "alt": "題圖描述" }`。
- 新題的 `questionId` 和 `revision` 由服務產生。相同題庫內容重送時會回報 `already_imported`，保留已發佈題庫的後續編輯。目錄一次發佈一批題庫。若發佈前遇到目錄版本衝突，重新讀取目錄後可用完全相同的原始匯入資料續送。

### 勘誤、修正跑版或修改題幹

先 `get` 題庫。照來源逐題核對，直接手寫有限欄位的 `set`，附上原因。每次修改使用最新讀到的題庫 `version` 和確切 `questionId`。下面的 `version` 和 `questionId` 是格式示意，送出時須替換成 `get` 的回傳值。

```json
{
  "key": "生理學｜B10 考古",
  "version": "\"Firebase ETag\"",
  "edits": [
    {
      "questionId": "q_從讀取結果複製",
      "set": { "question": "校正後的完整題幹", "answer": "B", "explanation": "與更新後答案對齊的詳解。" },
      "reason": "對照原卷第 8 題及公布勘誤，更新題幹、答案與詳解。"
    }
  ]
}
```

`set` 接受 `question`、`options`、`answer`、`explanation`、`origin`、`image`、`taxonomy`、`provenance`。只列本次需要改的欄位。明確設定 `image: null` 可移除該題圖的引用。每份題庫的編修一次提交，原 `questionId`、題序和個人作答快照保留。變更會增加該題 `revision`，並在題目歷史保存原值與原因。舊題若本來只有前端推算的 ID，第一次修訂會把原本推算的 ID 寫回題庫。

如果得到 `409 conflict`，重新 `get` 取得新版，先核對剛才想改的地方是否被其他人同時修改，再用新的版本送出。若網路中斷，先讀回檢查寫入結果。

### 批次改科目或題庫名稱

先 `list` 取得當前目錄 `version`。用確切 `key` 指定題庫，`title` 可使用 `科目｜名稱`。每批可改 1 至 500 份，同一操作會驗證改名後的名稱衝突。

```json
{
  "version": "\"目錄的 Firebase ETag\"",
  "renames": [
    { "key": "生理學｜B10 考古", "title": "基礎醫學｜B10 生理學考古" },
    { "key": "生理學｜B09 考古", "title": "基礎醫學｜B09 生理學考古" }
  ]
}
```

此操作更新目錄顯示名稱。Firebase 路徑、題庫 `key`、`storageKey`、`questionId`、題目分類欄位與作答紀錄皆沿用。後續 `get` 和 `edit` 一樣用原 `key`。題幹本身的批次修正走 `edit`。

## HTTP 端點

執行 `npm run agent:api` 會在 `http://127.0.0.1:4191` 啟動。每個請求需要 `Authorization: Bearer <TEAH_AGENT_TOKEN>`。`POST` 使用 `application/json`，可在上面的請求物件加 `"apply": true` 發佈，省略時只預檢。

| 方法與路徑 | 用途 | 主要回傳 |
| --- | --- | --- |
| `GET /v1/banks` | 列出正常及典藏題庫 | 目錄 `version`、題庫 `key`、顯示名稱、題數、`storageKey` |
| `GET /v1/bank?key=...` | 依 URL 編碼後的鍵讀取題庫 | 題庫 `version`、各題 `questionId`／`revision` 及內容 |
| `POST /v1/banks/import` | 預檢或發佈 `banks` | 每份題庫的處理狀態 |
| `POST /v1/banks/edit` | 依 `key`、`version`、`edits` 修同一份題庫 | 變更的題目 ID、欄位及新版本 |
| `POST /v1/banks/rename` | 以目錄 `version` 批次更新 `renames` | 舊名稱與新名稱 |
| `POST /v1/images` | 傳入 `contentType`、原始圖檔的 `base64` | 不可變的圖片 `path` |

POST 上限 8 MiB。`401` 表示憑證無效，`400` 是輸入有誤，`404` 是端點或題庫不存在，`409` 是同名或版本衝突。端點只接受本機連線，可供有 Teah 工作區與本機終端的 Agent 呼叫。外部雲端 Agent 需另有授權連線方式。

### 機器憑證的一次設定

使用 Node.js 22+ 並執行 `npm ci`。由維護者在專案目錄之外建立 `~/.config/teah/agent.env`（檔案權限 `600`），或以 `TEAH_AGENT_CONFIG` 指定另一份私密檔案。填入 Firebase URL、至少 32 字元的隨機 `TEAH_AGENT_TOKEN` 與伺服器的 `GOOGLE_APPLICATION_CREDENTIALS` 憑證路徑。環境若已提供服務帳戶的 Application Default Credentials，可直接使用。用 `npm run --silent agent -- list` 驗證，不需要瀏覽器登入或重複核准。

服務帳戶由本機服務持有，HTTP 呼叫端只需 Agent token。把憑證和 token 保持在本機設定，勿貼入聊天、題庫 JSON、瀏覽器程式或提交 Git。Firebase 前端權限沿用現有登入及管理員規則。服務提供的資料範圍為題庫、目錄與題圖。
