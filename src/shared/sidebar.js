export function mountSidebar() {
    const home = document.querySelector('.start-screen');
    const nav = document.querySelector('.library-shortcuts');
    const toggle = document.getElementById('sidebarToggle');
    const backdrop = document.getElementById('sidebarBackdrop');
    const sidebar = document.getElementById('siteSidebar');
    const mobile = matchMedia('(max-width:700px)');
    const icons = {
        '題庫': '<path d="m3 10 9-7 9 7v11H3ZM9 21v-8h6v8"/>',
        '典藏庫': '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M10 12h4"/>',
        '錯題本': '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M8 3v5H3M12 5h9M12 9h6M8 14l5 5m0-5-5 5"/>',
        '已收藏': '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/>',
        '自訂測驗': '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h4M8 16h6"/>',
        '學習總覽': '<path d="M4 3v17h17M8 16v-4m5 4V8m5 8V5"/>',
        '資料與隱私': '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
        'Flashcard': '<rect x="4" y="6" width="16" height="15" rx="2"/><path d="M7 3h10M9 11h6M9 16h4"/>',
        '我的回報': '<path d="M4 21V4c5-4 10 4 16 0v10c-6 4-11-4-16 0"/>',
        '內容工作台': '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3"/>'
    };
    for (const button of nav.querySelectorAll('button')) {
        const label = button.textContent.trim();
        button.setAttribute('aria-label', label); button.title = label;
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        for (const [key, value] of Object.entries({ class: 'sidebar-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(key, value);
        icon.innerHTML = icons[label] || icons['自訂測驗'];
        const text = document.createElement('span'); text.className = 'sidebar-label'; text.textContent = label;
        button.replaceChildren(icon, text);
    }
    const getStoredWidth = () => {
        try {
            const w = parseInt(localStorage.getItem('teah-sidebar-custom-width'), 10);
            return w >= 180 && w <= 600 ? w : 240;
        } catch {
            return 240;
        }
    };
    const stored = () => { try { return localStorage.getItem('teah-sidebar-collapsed') === 'true'; } catch { return false; } };
    const isExpanded = () => mobile.matches ? home.classList.contains('sidebar-open') : !home.classList.contains('sidebar-collapsed');
    function setCollapsed(collapsed, save = false) {
        home.classList.toggle('sidebar-collapsed', collapsed);
        home.classList.toggle('sidebar-open', !collapsed && mobile.matches);
        if (collapsed) {
            home.style.removeProperty('--sidebar-width');
        } else if (!mobile.matches) {
            home.style.setProperty('--sidebar-width', `${getStoredWidth()}px`);
        }
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? '展開側邊導覽' : '收合側邊導覽');
        toggle.title = collapsed ? '展開導覽' : '收合導覽';
        backdrop.hidden = collapsed || !mobile.matches;
        if (sidebar) sidebar.inert = collapsed && mobile.matches;
        if (save && !mobile.matches) try { localStorage.setItem('teah-sidebar-collapsed', String(collapsed)); } catch {}
    }
    setCollapsed(mobile.matches || stored());
    toggle.onclick = e => {
        e?.stopPropagation();
        home.classList.add('sidebar-animating');
        setCollapsed(isExpanded(), true);
    };
    if (sidebar) {
        sidebar.addEventListener('click', e => {
            if (!mobile.matches && home.classList.contains('sidebar-collapsed')) {
                if (!e.target.closest('.library-shortcuts button, #controlsMenuBtn, #signInBtn, .sidebar-resizer')) {
                    home.classList.add('sidebar-animating');
                    setCollapsed(false, true);
                }
            }
        });
    }
    const topbarSidebarHeader = document.querySelector('.topbar-sidebar-header');
    if (topbarSidebarHeader) {
        topbarSidebarHeader.addEventListener('click', e => {
            if (e.target.closest('#sidebarToggle')) return;
            if (!mobile.matches && home.classList.contains('sidebar-collapsed')) {
                e.preventDefault();
                home.classList.add('sidebar-animating');
                setCollapsed(false, true);
            }
        });
    }
    const resizer = document.getElementById('sidebarResizer');
    if (resizer) {
        let isDragging = false;
        resizer.addEventListener('pointerdown', e => {
            if (mobile.matches || e.button !== 0) return;
            isDragging = true;
            document.body.classList.add('sidebar-resizing');
            resizer.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        resizer.addEventListener('pointermove', e => {
            if (!isDragging) return;
            const x = e.clientX;
            if (x < 130) {
                if (!home.classList.contains('sidebar-collapsed')) {
                    setCollapsed(true, true);
                }
            } else {
                if (home.classList.contains('sidebar-collapsed')) {
                    setCollapsed(false, true);
                }
                const maxW = Math.min(Math.round(window.innerWidth * 0.5), 500);
                const w = Math.min(Math.max(x, 180), maxW);
                home.style.setProperty('--sidebar-width', `${w}px`);
            }
        });
        const stopDrag = e => {
            if (!isDragging) return;
            isDragging = false;
            document.body.classList.remove('sidebar-resizing');
            try { resizer.releasePointerCapture(e.pointerId); } catch {}
            if (!home.classList.contains('sidebar-collapsed')) {
                const currentW = parseInt(getComputedStyle(home).getPropertyValue('--sidebar-width'), 10);
                if (currentW >= 180) {
                    try { localStorage.setItem('teah-sidebar-custom-width', String(currentW)); } catch {}
                }
            }
        };
        resizer.addEventListener('pointerup', stopDrag);
        resizer.addEventListener('pointercancel', stopDrag);
    }
    backdrop.onclick = () => { home.classList.add('sidebar-animating'); setCollapsed(true); toggle.focus(); };
    nav.addEventListener('click', e => { if (mobile.matches && e.target.closest('button')) { home.classList.add('sidebar-animating'); setCollapsed(true); } });
    home.addEventListener('keydown', e => {
        if (e.key === 'Escape' && isExpanded() && !document.querySelector('dialog[open]')) { home.classList.add('sidebar-animating'); setCollapsed(true); toggle.focus(); }
    });
    mobile.addEventListener('change', () => { home.classList.remove('sidebar-animating'); setCollapsed(mobile.matches || stored()); });
}
