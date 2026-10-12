const cleanName = value => String(value || '').trim().replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, '').trim();
const xmlText = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildMultiUnitPrompt(subjectRaw) {
    const subject = cleanName(subjectRaw);
    if (!subject) throw new Error('請輸入科目名稱');
    const exampleQuestion = {
        origin: '出自 B11 考古第 1 題',
        question: '下列何者是細胞主要的能量載體？',
        options: { A: 'DNA', B: 'ATP', C: 'RNA', D: 'NADH' },
        answer: 'B', explanation: 'ATP 是細胞主要的能量載體。'
    };
    const schema = JSON.stringify({ banks: [
        { title: `${subject}｜B11 考古`, questions: [exampleQuestion] },
        { title: `${subject}｜B10 考古`, questions: [{ ...exampleQuestion, origin: '出自 B10 考古第 1 題' }] },
        { title: `${subject}｜抗生素`, questions: [{
            origin: '出自抗生素單元第 1 題', question: 'β-lactam 類抗生素主要抑制哪項細胞結構的合成？',
            answer: ['細胞壁'], explanation: '此類抗生素抑制細菌細胞壁合成。'
        }] }
    ] }, null, 2);
    return `<?xml version="1.0" encoding="UTF-8"?>
<prompt>
  <role>你是醫學與資訊學科題庫資料結構化專家。將題目文本或 PDF 題目卷與詳解卷精準配對，轉換為可一次匯入多份題庫的 JSON。</role>
  <task>
    使用者指定的科目名稱：<subject>${xmlText(subject)}</subject>。這是所有題庫標題的固定前綴，不是要擷取的單一單元；請處理提供資料中的所有年份與單元。
    1. 先閱讀 PDF 目錄與章節標題，依原文件的分組模式建立題庫，不自行猜測或新增單元。
    2. 若文件按屆數、年份或考卷編排，每份考卷建立一份題庫，title 使用「科目｜年份 考卷名稱」，例如「${xmlText(subject)}｜B11 考古」、「${xmlText(subject)}｜B10 考古」、「${xmlText(subject)}｜B09 考古」。依題本原文定義屆數，保留原始年份／屆數及前導零，不自行換算；title 與 origin 都不可將 B09 改寫為 B9，也不可把屆數編成 B1、B2 等流水號。
    3. 若考古 PDF 按單元編排（例如舊考古的單元目錄），依目錄的單元名稱分組，title 使用「科目｜單元名稱」，例如「${xmlText(subject)}｜抗生素」。單元中的題目即使來自多個年份，也依原 PDF 單元分組，origin 保留每題實際年份與題號。
    4. 同一組題目只收錄一次；不要把按單元整理的相同題目再複製成每年份題庫。若資料同時包含獨立的年份考卷與單元章節，依各部分的實際編排整理。
    5. 輸出【一個 Markdown JSON Code Block】，其中只有【一個 JSON 物件】，格式為 {"banks":[{"title":"題庫標題","questions":[題目物件]}]}。所有題庫（即使有 10 份或更多）都放在同一個 banks 陣列，讓使用者只需複製一次。
    6. title 必須在 JSON 內；禁止在 JSON 外另列 Markdown 標題，禁止輸出多個 Code Block，也禁止只輸出未含標題的題目陣列。title 不可重複或包含 . # $ [ ] / 或控制字元。
    7. 每份 questions 必須是非空題目陣列；不要輸出範例中來源沒有的年份或單元，不要輸出省略號、註解、佔位文字或截斷的 JSON。
  </task>

  <constraints>
    ### 1. 資料處理、配對與排序
    * **資料完整性與持續性**：請務必完整處理使用者輸入的所有年份題目。若個別題目或答案完全缺失，請跳過該題；但【嚴禁因為年份或題數過多而擅自中斷、精簡或漏失任何一整年的內容】。
    * **雙文件（題目卷 + 詳解卷）交叉核對**：詳解卷與題目卷之題號可能跨頁或順序微調，請務必根據「題目核心文字」與「年份題號」雙向核對，確保題目、選項與詳解完全對齊。若詳解卷中某題無解析，\`explanation\` 請填寫空字串 \`""\`，不可遺漏題目。
    * **排序規則**：請將年份題庫由新到舊排列（例如 B11、B10、B09）；單元題庫依 PDF 目錄順序排列；在每份題庫的 questions 陣列內，題目請統一依試卷題號由第 1 題遞增排序到最後一題。
    * **內容保留**：禁止擅自修改或精簡題幹與詳解內容，但請自動「刪除句中多餘的連續空白與換行雜訊」。
    * **連續性題組**：若遇到連續性題組（共同題幹），必須在每題的 \`question\` 欄位開頭自動補上該題組的「共同背景描述」，確保單看該題也能明確理解題意。
    * **圖表與特殊符號**：若原題包含圖表或影像，請在 \`question\` 內以 \`[圖表：描述]\` 或 \`[圖片]\` 標記其相對位置。

    ### 2. 格式與排版規範
    * **純淨輸出**：整個輸出結果中【只能包含一個 JSON Code Block，內含完整的 banks 物件】。嚴禁在 Code Block 之外寫下任何「好的，以下是為您整理的...」或「注意：我修正了...」等任何人類對話或註解。
    * **中文標點**：題目與詳解若為中文，請統一使用全形標點符號（如：，、？）。
    * **上標與下標**：若出現化學式、生物標記或數學公式，請嚴格使用 LaTeX 語法包裹（例如：$CD4^+$、$T_{FH}$、\\text{pH} < 6.5）。
    * **特殊符號替換**：禁止使用「~」符號，請一律轉換為文字，如「2到3」或「2 to 3」，避免 Markdown 渲染錯誤。

    ### 3. 四大題型欄位規範（單選、是非 TF、多選、填空）
    * **欄位切割**：嚴禁將解釋/詳解寫到題目中，亦不得將題目內容移至解釋中。
    * **origin（出處）**：必須明確擷取並寫出是「哪一年」的「哪一題」，例如 \`"出自 B11 考古第 1 題"\` 或 \`"出自 111學年度 區段考第 5 題"\`。請將原題幹開頭的題號序號刪除。
    * **【單選題】**：
      * \`options\`：若原始選項帶有 \`(1)(2)(3)(4)\` 或 \`1.2.3.4.\`，請一律**刪除這些前綴數字**，統一對應到大寫字母鍵值（\`"A"\`, \`"B"\`, \`"C"\`, \`"D"\`，若有第五選項為 \`"E"\`）。
      * \`answer\`：必須為**單一字串**（嚴禁中括號或引號內多字母），且必須為 \`options\` 中的某一鍵。例如：\`"answer": "B"\`。
    * **【是非題】**：
      * \`options\`：欄位必須嚴格固定為 \`{"T": "True", "F": "False"}\`。若原題使用 \`(O)(X)\`，請自動在題目與詳解中更正為 \`(T)(F)\`。
      * \`answer\`：必須為單一字串 \`"answer": "T"\` 或 \`"answer": "F"\`。
    * **【多選題】**（題目註記多選，或官方答案包含兩個以上選項）：
      * \`options\`：物件，包含 2 個以上選項（\`"A"\`, \`"B"\`, \`"C"\`...）。
      * \`answer\`：必須使用 **JSON Array 格式**，包含所有正確選項代號，例如 \`"answer": ["A", "C"]\` 或 \`"answer": ["A", "B", "D"]\`。一個引號內嚴禁出現多個字母（禁止 \`"A/D"\` 或 \`"A, B"\`）。
    * **【填空題 / 簡答題】**（無選項之問答、名詞解釋或填空）：
      * \`options\`：**絕對不要建立 options 欄位（請在 JSON 中直接省略 options）**。
      * \`answer\`：必須使用 **JSON Array 格式**，提供足以讓 Gemini 正確判讀作答對錯的標準答案或核心關鍵字即可（本系統由 Gemini 進行語意閱卷與評分，無需刻意窮舉所有同義詞、全稱或縮寫）。例如：\`"answer": ["BCR-ABL"]\` 或 \`"answer": ["現金股利"]\`。

    ### 4. 詳解與 AI 校正機制（嚴禁在 JSON 外部寫註解）
    * 每題均須配對對應的 \`explanation\`。
    * **Gemini 註記機制**：當你發現原題的詳解有誤、答案有爭議、或是你有更精準的醫學解釋時，**請直接寫在該題的 \`explanation\` 欄位內部最後面**。
    * 若修改了錯誤答案，\`answer\` 欄位請放上你認為的正確答案，並在 \`explanation\` 內容的最末端，自動換行並加上以下標記：
      \`\\n\\n**Gemini：[在此輸入你認為更詳細的補充、正確答案或修正後的詳解]**\`
  </constraints>

  <output_schema>
    以下僅示範年份題庫與單元題庫的結構。實際 title 與題目必須根據提供文件，完整包含全部題庫與四大題型，不限於範例的三份或每份一題。
\`\`\`json
${schema}
\`\`\`
  </output_schema>
</prompt>`;
}

export function buildSingleUnitPrompt(targetUnitRaw) {
    const sanitized = (targetUnitRaw || '').trim().replace(/[.#$\[\]\/]/g, '');
    const targetUnit = sanitized || 'B12 考古';
    return `<?xml version="1.0" encoding="UTF-8"?>
<prompt>
  <role>你是一個嚴謹的醫學與資訊學科考古題資料結構化專家。你的任務是將使用者提供的題目文本或兩份 PDF（題目卷與詳解卷），精準轉換為本系統指定的 JSON 題庫格式。你必須保持極致的客觀與結構化，絕對不加入任何額外的聊天、前言、後記或 Markdown 區塊外的註解。</role>

  <task>
    【使用者指定任務】：本次僅製作【${targetUnit}】的題目。
    請閱讀使用者輸入的題目與詳解內容，【僅鎖定屬於「${targetUnit}」的題目與詳解進行擷取與轉換】，其餘所有不屬於「${targetUnit}」的年份、考卷或單元題目請一律忽略不輸出。
    **重要輸出要求**：
    1. 本次任務只需輸出【單一獨立的 JSON Array】，放入【一個 Markdown Code Block (\`\`\`json ... \`\`\`)】當中。
    2. 在該 Markdown Code Block 上方，請務必標註該題庫的建議命名標題，格式必須為：\`### 科目區段｜${targetUnit}\`（例如：\`### 檢驗醫學區段一｜${targetUnit}\`）。
       - 注意：題庫名稱中【絕對不可包含】下列字元：\`.\` \`#\` \`$\` \`[\` \`]\` \`/\`。
  </task>

  <constraints>
    ### 1. 資料處理、範圍限定與排序
    * **範圍限定（嚴禁輸出其他單元）**：使用者僅需要【${targetUnit}】的題目。若輸入內容包含多個年份或單元，請直接略過其他部分，只擷取【${targetUnit}】。
    * **資料完整性**：在【${targetUnit}】範圍內，請務必完整處理所有題目。若個別題目或答案完全缺失，請跳過該題；但【嚴禁擅自中斷、精簡或漏失「${targetUnit}」內的任何題目】。
    * **雙文件（題目卷 + 詳解卷）交叉核對**：詳解卷與題目卷之題號可能跨頁或順序微調，請務必根據「題目核心文字」與「試卷題號」雙向核對，確保題目、選項與詳解完全對齊。若詳解卷中某題無解析，\`explanation\` 請填寫空字串 \`""\`，不可遺漏題目。
    * **排序規則**：題目請統一依試卷題號由第 1 題遞增排序到最後一題。
    * **內容保留**：禁止擅自修改或精簡題幹與詳解內容，但請自動「刪除句中多餘的連續空白與換行雜訊」。
    * **連續性題組**：若遇到連續性題組（共同題幹），必須在每題的 \`question\` 欄位開頭自動補上該題組的「共同背景描述」，確保單看該題也能明確理解題意。
    * **圖表與特殊符號**：若原題包含圖表或影像，請在 \`question\` 內以 \`[圖表：描述]\` 或 \`[圖片]\` 標記其相對位置。

    ### 2. 格式與排版規範
    * **純淨輸出**：整個輸出結果中【只能包含單一 Markdown 題庫標題與一個 JSON Code Block】。嚴禁在 Code Block 之外寫下任何「好的，以下是為您整理的...」或「注意：我修正了...」等任何人類對話或註解。
    * **中文標點**：題目與詳解若為中文，請統一使用全形標點符號（如：，、？）。
    * **上標與下標**：若出現化學式、生物標記或數學公式，請嚴格使用 LaTeX 語法包裹（例如：$CD4^+$、$T_{FH}$、\\text{pH} < 6.5）。
    * **特殊符號替換**：禁止使用「~」符號，請一律轉換為文字，如「2到3」或「2 to 3」，避免 Markdown 渲染錯誤。

    ### 3. 四大題型欄位規範（單選、是非 TF、多選、填空）
    * **欄位切割**：嚴禁將解釋/詳解寫到題目中，亦不得將題目內容移至解釋中。
    * **origin（出處）**：必須明確寫出出處與題號，統一格式為 \`"出自 ${targetUnit} 第 X 題"\`（例如：\`"出自 ${targetUnit} 第 1 題"\`）。請將原題幹開頭的題號序號刪除。
    * **【單選題】**：
      * \`options\`：若原始選項帶有 \`(1)(2)(3)(4)\` 或 \`1.2.3.4.\`，請一律**刪除這些前綴數字**，統一對應到大寫字母鍵值（\`"A"\`, \`"B"\`, \`"C"\`, \`"D"\`，若有第五選項為 \`"E"\`）。
      * \`answer\`：必須為**單一字串**（嚴禁中括號或引號內多字母），且必須為 \`options\` 中的某一鍵。例如：\`"answer": "B"\`。
    * **【是非題】**：
      * \`options\`：欄位必須嚴格固定為 \`{"T": "True", "F": "False"}\`。若原題使用 \`(O)(X)\`，請自動在題目與詳解中更正為 \`(T)(F)\`。
      * \`answer\`：必須為單一字串 \`"answer": "T"\` 或 \`"answer": "F"\`。
    * **【多選題】**（題目註記多選，或官方答案包含兩個以上選項）：
      * \`options\`：物件，包含 2 個以上選項（\`"A"\`, \`"B"\`, \`"C"\`...）。
      * \`answer\`：必須使用 **JSON Array 格式**，包含所有正確選項代號，例如 \`"answer": ["A", "C"]\` 或 \`"answer": ["A", "B", "D"]\`。一個引號內嚴禁出現多個字母（禁止 \`"A/D"\` 或 \`"A, B"\`）。
    * **【填空題 / 簡答題】**（無選項之問答、名詞解釋或填空）：
      * \`options\`：**絕對不要建立 options 欄位（請在 JSON 中直接省略 options）**。
      * \`answer\`：必須使用 **JSON Array 格式**，提供足以讓 Gemini 正確判讀作答對錯的標準答案或核心關鍵字即可（本系統由 Gemini 進行語意閱卷與評分，無需刻意窮舉所有同義詞、全稱或縮寫）。例如：\`"answer": ["BCR-ABL"]\` 或 \`"answer": ["現金股利"]\`。

    ### 4. 詳解與 AI 校正機制（嚴禁在 JSON 外部寫註解）
    * 每題均須配對對應的 \`explanation\`。
    * **Gemini 註記機制**：當你發現原題的詳解有誤、答案有爭議、或是你有更精準的醫學解釋時，**請直接寫在該題的 \`explanation\` 欄位內部最後面**。
    * 若修改了錯誤答案，\`answer\` 欄位請放上你認為的正確答案，並在 \`explanation\` 內容的最末端，自動換行並加上以下標記：
      \`\\n\\n**Gemini：[在此輸入你認為更詳細的補充、正確答案或修正後的詳解]**\`
  </constraints>

  <output_schema>
    請嚴格參照以下格式輸出。僅輸出單一一個合法的 JSON Array Code Block，並在上方以 Markdown 三級標題標記題庫名稱：

### 檢驗醫學區段一｜${targetUnit}
\`\`\`json
[
  {
    "origin": "出自 ${targetUnit} 第 1 題",
    "question": "Which molecule is known as the energy currency of the cell?",
    "options": {
      "A": "DNA",
      "B": "ATP",
      "C": "RNA",
      "D": "NADH",
      "E": "FADH2"
    },
    "answer": "B",
    "explanation": "ATP (adenosine triphosphate) is the primary energy carrier in all living organisms."
  },
  {
    "origin": "出自 ${targetUnit} 第 2 題",
    "question": "下列關於原發性肺結核病理變化的敘述是否正確？Ghon complex 包含肺部實質病灶與肺門淋巴結腫大。",
    "options": {
      "T": "True",
      "F": "False"
    },
    "answer": "T",
    "explanation": "原發性肺結核典型的 Ghon complex 即由 Ghon focus 加上同側肺門淋巴結病變所組成。"
  },
  {
    "origin": "出自 ${targetUnit} 第 3 題",
    "question": "下列哪些數值屬於質數（Prime numbers）？（多選）",
    "options": {
      "A": "2",
      "B": "3",
      "C": "4",
      "D": "5",
      "E": "6"
    },
    "answer": ["A", "B", "D"],
    "explanation": "2, 3, and 5 are prime numbers, while 4 and 6 are composite numbers."
  },
  {
    "origin": "出自 ${targetUnit} 第 4 題",
    "question": "在慢性骨髓性白血病（CML）中，常見由 t(9;22) 染色體易位形成的費城染色體融合基因是 ______。",
    "answer": ["BCR-ABL"],
    "explanation": "費城染色體造成 9 號染色體 ABL 與 22 號染色體 BCR 融合形成 BCR-ABL 融合基因。\\n\\n**Gemini：臨床上首選標靶藥物為酪胺酸激酶抑制劑（如 Imatinib）。**"
  }
]
\`\`\`
  </output_schema>
</prompt>`;
}
