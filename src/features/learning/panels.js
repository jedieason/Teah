import { summarize, DAY } from './model.js';

export function node(tag, text, parent, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    parent?.append(element);
    return element;
}
export function section(parent, title, description) {
    const card = node('section', null, parent, 'panel-card');
    node('h3', title, card);
    if (description) node('p', description, card, 'panel-muted');
    return card;
}
export function empty(parent, title, description) {
    const card = node('div', null, parent, 'panel-empty');
    node('strong', title, card);
    if (description) node('p', description, card);
}
export function metric(parent, label, value, detail) {
    const card = node('div', null, parent, 'panel-metric');
    node('span', label, card, 'panel-muted');
    node('strong', value, card);
    if (detail) node('small', detail, card, 'panel-muted');
}
export function progress(parent, value, max, label) {
    const bar = node('progress', null, parent, 'panel-progress');
    bar.max = Math.max(1, max); bar.value = Math.max(0, value);
    bar.setAttribute('aria-label', label);
    return bar;
}
export function overview(body, state, now) {
    const attempts = Object.values(state.attempts || {});
    const recent = summarize(attempts, now - 7 * DAY);
    const previous = summarize(attempts.filter(e => e.submittedAt < now - 7 * DAY), now - 14 * DAY);
    const due = Object.values(state.reviews || {}).filter(r => r.dueAt <= now).length;
    const metrics = node('div', null, body, 'panel-metrics');
    metric(metrics, '近 7 天作答', recent.count, `前 7 天 ${previous.count} 次`);
    metric(metrics, '正確率', recent.accuracy == null ? '—' : `${recent.accuracy}%`, previous.accuracy == null ? '前 7 天尚無紀錄' : `前 7 天 ${previous.accuracy}%`);
    metric(metrics, '平均作答時間', recent.count ? `${recent.seconds} 秒` : '—', '近 7 天 · 每題');
    metric(metrics, '到期複習', due, '題目 · 截至目前');
    const grid = node('div', null, body, 'panel-grid');
    const activity = section(grid, '每日練習', '最近 7 個日曆日 · 作答次數');
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(today); date.setDate(date.getDate() - 6 + index);
        const end = new Date(date); end.setDate(end.getDate() + 1);
        return { date, count: attempts.filter(e => e.submittedAt >= +date && e.submittedAt < +end).length };
    });
    const chart = node('div', null, activity, 'panel-chart');
    const max = Math.max(1, ...days.map(day => day.count));
    for (const { date, count } of days) {
        const column = node('div', null, chart, 'panel-chart-column');
        column.setAttribute('aria-label', `${date.toLocaleDateString()}：${count} 次作答`);
        node('strong', count, column);
        const track = node('div', null, column, 'panel-chart-track');
        const bar = node('div', null, track, 'panel-chart-bar');
        bar.style.height = `${count / max * 100}%`;
        node('span', `${date.getMonth() + 1}/${date.getDate()}`, column);
    }
    const topics = section(grid, '科目與主題表現', '全部紀錄 · 依正確率由低到高排列');
    const groups = {};
    for (const event of attempts) (groups[event.taxonomy?.topic || event.taxonomy?.subject || '未分類'] ||= []).push(event);
    if (!attempts.length) empty(topics, '尚無主題紀錄');
    const topicList = node('div', null, topics, 'panel-topic-list');
    for (const [topic, rows] of Object.entries(groups).sort((a, b) => summarize(a[1]).accuracy - summarize(b[1]).accuracy)) {
        const summary = summarize(rows), item = node('div', null, topicList, 'panel-topic');
        const label = node('div', null, item, 'panel-row');
        node('strong', topic, label); node('span', `${summary.accuracy}%`, label, 'panel-badge');
        progress(item, summary.accuracy, 100, `${topic}正確率 ${summary.accuracy}%`);
        node('small', `${summary.count} 次作答 · 平均 ${summary.seconds} 秒／題`, item, 'panel-muted');
    }
    const sessionsCard = section(body, '最近測驗', '最近 10 場');
    const sessions = {};
    for (const event of attempts) (sessions[event.sessionId] ||= []).push(event);
    if (!attempts.length) empty(sessionsCard, '尚無測驗紀錄');
    const sessionsGrid = node('div', null, sessionsCard, 'panel-session-grid');
    for (const rows of Object.values(sessions).sort((a, b) => Math.max(...b.map(e => e.submittedAt)) - Math.max(...a.map(e => e.submittedAt))).slice(0, 10)) {
        const summary = summarize(rows), card = node('article', null, sessionsGrid, 'panel-session');
        node('span', rows[0].mode === 'exam' ? '考試' : '學習', card, 'panel-badge');
        node('strong', `${summary.accuracy}%`, card, 'panel-session-score');
        node('span', `${summary.count} 題 · ${new Date(Math.max(...rows.map(e => e.submittedAt))).toLocaleDateString()}`, card, 'panel-muted');
    }
    const history = node('details', null, body, 'panel-card panel-history');
    node('summary', '最近作答紀錄', history);
    if (!attempts.length) empty(history, '尚無作答紀錄');
    const list = node('ol', null, history, 'panel-history-list');
    for (const event of attempts.sort((a, b) => b.submittedAt - a.submittedAt).slice(0, 30)) {
        const item = node('li', null, list, 'panel-row');
        const info = node('div', null, item);
        node('strong', event.taxonomy?.subject || '未分類', info);
        node('small', `${new Date(event.submittedAt).toLocaleString()} · ${event.mode === 'exam' ? '考試' : '學習'} · v${event.questionRevision}`, info, 'panel-muted');
        node('span', event.isCorrect ? '正確' : '待加強', item, `panel-badge ${event.isCorrect ? 'is-success' : 'is-review'}`);
    }
    node('p', '複習間隔採簡單倍增規則（1–90 天）；此數據僅反映練習表現，不代表臨床能力或記憶保留率。', body, 'panel-footnote');
}
