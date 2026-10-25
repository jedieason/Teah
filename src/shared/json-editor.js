// A native textarea keeps editing/selection behavior; its mirror paints error text.
export function mountJsonErrorEditor(textarea, backdrop, locationLabel, jumpButton) {
    let issue = null;
    const mirror = backdrop.querySelector('pre');
    const syncScroll = () => {
        backdrop.scrollTop = textarea.scrollTop;
        backdrop.scrollLeft = textarea.scrollLeft;
    };
    textarea.addEventListener('scroll', syncScroll);
    const resizeObserver = new ResizeObserver(syncScroll);
    resizeObserver.observe(textarea);

    function reveal(focus = false) {
        if (!issue) return;
        const style = getComputedStyle(textarea);
        const lineHeight = parseFloat(style.lineHeight);
        const padding = parseFloat(style.paddingTop);
        // Measuring the prefix also handles Chinese text, emoji and proportional glyphs.
        const prefix = document.createElement('span');
        prefix.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font};tab-size:${style.tabSize}`;
        const start = issue.position > 0 ? textarea.value.lastIndexOf('\n', issue.position - 1) + 1 : 0;
        prefix.textContent = textarea.value.slice(start, issue.position);
        document.body.append(prefix);
        const left = prefix.getBoundingClientRect().width;
        prefix.remove();
        if (focus) {
            textarea.focus({ preventScroll: true });
            textarea.setSelectionRange(issue.position, issue.end ?? issue.position);
        }
        textarea.scrollTop = Math.max(0, (issue.line - 1) * lineHeight + padding - textarea.clientHeight / 2);
        textarea.scrollLeft = Math.max(0, left - textarea.clientWidth / 3);
        syncScroll();
        textarea.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    jumpButton.addEventListener('click', () => reveal(true));
    return {
        setIssue(next) {
            issue = next;
            textarea.classList.toggle('has-json-issue', !!issue);
            textarea.setAttribute('aria-invalid', String(!!issue));
            jumpButton.hidden = !issue;
            locationLabel.hidden = !issue;
            backdrop.hidden = !issue;
            mirror.replaceChildren();
            if (!issue) return;
            locationLabel.textContent = `第 ${issue.line} 行，第 ${issue.col} 欄`;
            const text = textarea.value;
            const end = Math.min(text.length, issue.end ?? issue.position + 1);
            const lineStart = issue.position > 0 ? text.lastIndexOf('\n', issue.position - 1) + 1 : 0;
            const nextBreak = text.indexOf('\n', end);
            const lineEnd = nextBreak < 0 ? text.length : nextBreak;
            const line = document.createElement('span');
            line.className = 'json-error-line';
            const mark = document.createElement('mark');
            mark.textContent = text.slice(issue.position, end) || ' ';
            line.append(text.slice(lineStart, issue.position), mark, text.slice(end, lineEnd));
            mirror.append(text.slice(0, lineStart), line, text.slice(lineEnd), '\n');
            reveal();
        }
    };
}
