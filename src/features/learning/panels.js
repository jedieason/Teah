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
export function activityHeatmap(parent, attempts, now) {
    const card = section(parent, '活動熱力圖', '過去 30 天 · 每日作答次數與學習狀態');
    const today = new Date(now); today.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const end = new Date(date);
        end.setDate(end.getDate() + 1);
        const dayAttempts = attempts.filter(e => e.submittedAt >= +date && e.submittedAt < +end);
        const count = dayAttempts.length;
        const correct = dayAttempts.filter(e => e.isCorrect).length;
        const accuracy = count ? Math.round(correct / count * 100) : null;
        let level = 0;
        if (count >= 31) level = 4;
        else if (count >= 16) level = 3;
        else if (count >= 6) level = 2;
        else if (count >= 1) level = 1;

        days.push({
            date,
            isToday: i === 0,
            dayOfMonth: date.getDate(),
            dayOfWeek: date.getDay(),
            count,
            correct,
            accuracy,
            level,
            dateLabel: `${date.getMonth() + 1} 月 ${date.getDate()} 日`,
            fullDate: `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
        });
    }

    const totalCount = days.reduce((acc, d) => acc + d.count, 0);
    const activeDays = days.filter(d => d.count > 0).length;
    const maxCount = Math.max(0, ...days.map(d => d.count));
    let currentStreak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
        if (days[i].count > 0) {
            currentStreak++;
        } else if (i === days.length - 1) {
            continue;
        } else {
            break;
        }
    }

    const summaryRow = node('div', null, card, 'panel-heatmap-summary');
    const stat = (label, val, desc) => {
        const box = node('div', null, summaryRow, 'panel-heatmap-stat');
        node('span', label, box, 'panel-muted');
        node('strong', val, box);
        if (desc) node('small', desc, box, 'panel-muted');
    };
    stat('過去 30 天作答', `${totalCount} 題`, `活躍 ${activeDays} / 30 天`);
    stat('目前連續天數', `${currentStreak} 天`, activeDays ? (days[days.length - 1].count > 0 ? '今日已作答' : '今日未作答') : '尚無紀錄');
    stat('單日最高作答', `${maxCount} 題`, maxCount ? '單日最高紀錄' : '無作答');

    const wrap = node('div', null, card, 'panel-heatmap-wrap');
    const weekdays = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
    const weekdayHeader = node('div', null, wrap, 'panel-heatmap-header');
    for (const wd of weekdays) {
        node('span', wd, weekdayHeader, 'panel-heatmap-weekday');
    }

    const grid = node('div', null, wrap, 'panel-heatmap-grid');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', '過去 30 天活動熱力圖');

    const firstWd = (days[0].date.getDay() + 6) % 7;
    for (let p = 0; p < firstWd; p++) {
        const blank = node('div', null, grid, 'panel-heatmap-cell is-empty');
        blank.setAttribute('aria-hidden', 'true');
    }

    const weekdayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    const cellButtons = [];
    for (const d of days) {
        const cell = node('button', null, grid, 'panel-heatmap-cell');
        cell.type = 'button';
        cell.setAttribute('data-level', String(d.level));
        if (d.isToday) cell.classList.add('is-today');
        const wdName = weekdayNames[d.dayOfWeek];
        const desc = `${d.fullDate}（${wdName}）：作答 ${d.count} 題${d.count ? ` · 正確率 ${d.accuracy}%` : ''}`;
        cell.setAttribute('title', desc);
        cell.setAttribute('aria-label', desc);

        node('span', String(d.dayOfMonth), cell, 'panel-heatmap-date');
        if (d.count > 0) {
            node('span', String(d.count), cell, 'panel-heatmap-count');
        }
        cellButtons.push({ cell, desc });
    }

    const lastWd = (days[days.length - 1].date.getDay() + 6) % 7;
    for (let p = lastWd + 1; p < 7; p++) {
        const blank = node('div', null, grid, 'panel-heatmap-cell is-empty');
        blank.setAttribute('aria-hidden', 'true');
    }

    const footer = node('div', null, card, 'panel-heatmap-footer');
    const detail = node('div', '', footer, 'panel-heatmap-detail');
    const defaultText = `移至方格查看各日作答明細 · 過去 30 天共作答 ${totalCount} 題`;
    detail.textContent = defaultText;

    for (const { cell, desc } of cellButtons) {
        const show = () => { detail.textContent = desc; };
        cell.addEventListener('mouseenter', show);
        cell.addEventListener('focus', show);
        cell.addEventListener('click', show);
        cell.addEventListener('mouseleave', () => { detail.textContent = defaultText; });
        cell.addEventListener('blur', () => { detail.textContent = defaultText; });
    }

    const legend = node('div', null, footer, 'panel-heatmap-legend');
    node('span', '少', legend, 'panel-heatmap-legend-label');
    for (let l = 0; l <= 4; l++) {
        const box = node('span', null, legend, 'panel-heatmap-legend-box');
        box.setAttribute('data-level', String(l));
        const rangeText = l === 0 ? '0 題' : l === 1 ? '1–5 題' : l === 2 ? '6–15 題' : l === 3 ? '16–30 題' : '31+ 題';
        box.setAttribute('title', rangeText);
        box.setAttribute('aria-label', rangeText);
    }
    node('span', '多', legend, 'panel-heatmap-legend-label');
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
    activityHeatmap(body, attempts, now);
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
    node('p', '複習間隔採簡單倍增規則（1–90 天）；此數據僅反映練習表現，不代表臨床能力或記憶保留率。', body, 'panel-footnote');
}
