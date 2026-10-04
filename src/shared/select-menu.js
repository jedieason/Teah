// The native select remains the data source; all visible interaction is custom.
export function createSelectMenu(select) {
    const isMultiple = select.multiple;
    const wrapper = document.createElement('div');
    wrapper.className = 'select-menu';
    wrapper.dataset.for = select.id;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'select-menu-trigger';
    trigger.id = `${select.id}Trigger`;
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    const chevron = document.createElement('span');
    chevron.className = 'select-menu-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    trigger.append(label, chevron);
    const list = document.createElement('div');
    list.id = `${select.id}Listbox`;
    list.className = 'select-menu-list';
    list.setAttribute('role', 'listbox');
    if (isMultiple) list.setAttribute('aria-multiselectable', 'true');
    list.setAttribute('aria-label', select.getAttribute('aria-label'));
    list.hidden = true;
    trigger.setAttribute('aria-controls', list.id);
    wrapper.append(trigger, list);
    select.after(wrapper);
    select.hidden = true;
    let active = 0;
    let typeahead = '';
    let lastTyped = 0;
    const choices = () => [...select.options];

    function highlight(index) {
        active = Math.max(0, Math.min(index, list.children.length - 1));
        [...list.children].forEach((row, i) => row.classList.toggle('is-active', i === active));
        const row = list.children[active];
        if (row) {
            trigger.setAttribute('aria-activedescendant', row.id);
            row.scrollIntoView({ block: 'nearest' });
        }
    }
    function close() {
        list.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.removeAttribute('aria-activedescendant');
    }
    function refresh() {
        const items = choices();
        if (isMultiple) {
            const selectedOptions = items.filter(option => option.selected && option.value !== '');
            const count = selectedOptions.length;
            if (count === 0) {
                label.textContent = items[0]?.textContent || '';
                trigger.title = '';
            } else if (count === 1) {
                label.textContent = selectedOptions[0].textContent;
                trigger.title = '';
            } else if (count === 2) {
                label.textContent = selectedOptions.map(o => o.textContent).join('、');
                trigger.title = label.textContent;
            } else {
                const unit = select.dataset.unit || (select.id.toLowerCase().includes('subject') ? '科' : '項');
                label.textContent = `已選 ${count} ${unit}`;
                trigger.title = selectedOptions.map(o => o.textContent).join('、');
            }
            trigger.setAttribute('aria-label', `${select.getAttribute('aria-label')}：${label.textContent}`);
        } else {
            label.textContent = items.find(option => option.value === select.value)?.textContent || '';
            trigger.title = '';
            trigger.setAttribute('aria-label', `${select.getAttribute('aria-label')}：${label.textContent}`);
        }
        const prevScrollTop = list.scrollTop;
        list.replaceChildren(...items.map((option, i) => {
            const row = document.createElement('div');
            row.id = `${select.id}Option${i}`;
            row.className = 'select-menu-option';
            row.setAttribute('role', 'option');
            const isSelected = isMultiple
                ? (option.value === '' ? !items.some(opt => opt.value !== '' && opt.selected) : option.selected)
                : (option.value === select.value);
            row.setAttribute('aria-selected', String(isSelected));
            const text = document.createElement('span');
            text.textContent = option.textContent;
            const check = document.createElement('span');
            check.className = 'select-menu-check';
            check.setAttribute('aria-hidden', 'true');
            check.textContent = '✓';
            row.append(text, check);
            row.onpointermove = () => highlight(i);
            row.onclick = () => choose(i);
            return row;
        }));
        list.scrollTop = prevScrollTop;
        if (!list.hidden) highlight(isMultiple ? Math.max(0, Math.min(active, items.length - 1)) : Math.max(0, select.selectedIndex));
    }
    function open() {
        document.dispatchEvent(new CustomEvent('select-menu-open', { detail: trigger.id }));
        refresh();
        list.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        const defaultIndex = isMultiple
            ? Math.max(0, choices().findIndex(opt => opt.selected && opt.value !== ''))
            : Math.max(0, select.selectedIndex);
        highlight(defaultIndex >= 0 ? defaultIndex : 0);
    }
    function choose(index) {
        const items = choices();
        const option = items[index];
        if (!option) return;
        active = index;
        if (isMultiple) {
            if (index === 0 || option.value === '') {
                items.forEach((opt, i) => { opt.selected = (i === 0); });
            } else {
                option.selected = !option.selected;
                const anySelected = items.some((opt, i) => i > 0 && opt.value !== '' && opt.selected);
                if (items[0]) items[0].selected = !anySelected;
            }
            select.dispatchEvent(new Event('change', { bubbles: true }));
            refresh();
            highlight(index);
            trigger.focus({ preventScroll: true });
        } else {
            select.value = option.value;
            close();
            select.dispatchEvent(new Event('change', { bubbles: true }));
            refresh();
            trigger.focus({ preventScroll: true });
        }
    }
    trigger.onclick = () => list.hidden ? open() : close();
    trigger.onkeydown = event => {
        if (event.key === 'Escape' && !list.hidden) {
            event.preventDefault(); event.stopPropagation(); close(); return;
        }
        if (event.key === 'Tab') { close(); return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            if (list.hidden) { open(); return; }
            highlight(event.key === 'Home' ? 0 : event.key === 'End' ? choices().length - 1 : active + (event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); list.hidden ? open() : choose(active);
        } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.isComposing) {
            const now = Date.now();
            typeahead = now - lastTyped > 700 ? event.key : typeahead + event.key;
            lastTyped = now;
            if (list.hidden) open();
            const index = choices().findIndex(option => option.textContent.toLowerCase().startsWith(typeahead.toLowerCase()));
            if (index >= 0) highlight(index);
        }
    };
    document.addEventListener('pointerdown', event => { if (!wrapper.contains(event.target)) close(); });
    document.addEventListener('focusin', event => { if (!wrapper.contains(event.target)) close(); });
    document.addEventListener('select-menu-open', event => { if (event.detail !== trigger.id) close(); });
    refresh();
    return { refresh, close };
}
