// The supplied cutoff and repair question, with formatting variants of its bank/source.
export const cutoffPrefix = '卵巢癌（Ovarian cancer）最特徵性的轉移路徑';
export const cutoffQuestion = {
    origin: '出自 鄭永銘老師/腫瘤學（一） 第 3 題',
    question: 'Peritoneal seeding is a common spread pathway for?',
    options: { A: 'Colorectal cancer', B: 'Renal cell carcinoma', C: 'Ovarian cancer', D: 'Leiomyosarcoma' },
    answer: 'C',
    explanation: cutoffPrefix + '是穿透卵巢包膜後，直接脫落種植並廣泛播散於腹膜及腹膜腔表面（peritoneal seeding）。'
};
const earlier = n => ({ origin: `來源 第 ${n} 題`, question: `前文 ${n}`, answer: 'A', explanation: '已完成內容' });
export const originalBank = {
    title: '病理學區段二｜鄭永銘老師-腫瘤學（Neoplasm） （一）',
    questions: [earlier(1), earlier(2), cutoffQuestion, earlier(4)]
};
export const originalImport = { banks: [
    ...Array.from({ length: 12 }, (_, i) => ({ title: `前置題庫 ${i + 1}`, questions: [earlier(100 + i)] })),
    originalBank
] };
const source = JSON.stringify(originalImport, null, 2);
export const originalCutoff = source.slice(0, source.indexOf(cutoffPrefix) + cutoffPrefix.length);
export function repairResponse() {
    return { banks: [{
        title: '病理學區段二｜鄭永銘老師-腫瘤學（Neoplasm）（一）',
        questions: structuredClone(originalBank.questions.slice(2))
    }] };
}
