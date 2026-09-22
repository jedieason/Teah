export function mountSidebar() {
    const home = document.querySelector('.start-screen');
    const nav = document.querySelector('.library-shortcuts');
    const toggle = document.getElementById('sidebarToggle');
    const backdrop = document.getElementById('sidebarBackdrop');
    const mobile = matchMedia('(max-width:700px)');
    const icons = {
        '錯題本': '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M8 3v5H3M12 5h9M12 9h6M8 14l5 5m0-5-5 5"/>',
        '已收藏': '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/>',
        '自訂測驗': '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h4M8 16h6"/>',
        '學習總覽': '<path d="M4 3v17h17M8 16v-4m5 4V8m5 8V5"/>',
        '資料與隱私': '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
        '複習卡': '<rect x="6" y="6" width="15" height="15" rx="2"/><path d="M17 3H5a2 2 0 0 0-2 2v12M10 11h7m-7 5h5"/>',
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
    const stored = () => { try { return localStorage.getItem('teah-sidebar-collapsed') === 'true'; } catch { return false; } };
    function setCollapsed(collapsed, save = false) {
        home.classList.toggle('sidebar-collapsed', collapsed);
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? '展開側邊導覽' : '收合側邊導覽');
        toggle.title = collapsed ? '展開導覽' : '收合導覽';
        backdrop.hidden = collapsed || !mobile.matches;
        if (save) try { localStorage.setItem('teah-sidebar-collapsed', String(collapsed)); } catch {}
    }
    setCollapsed(mobile.matches || stored());
    toggle.onclick = () => setCollapsed(!home.classList.contains('sidebar-collapsed'), true);
    backdrop.onclick = () => { setCollapsed(true); toggle.focus(); };
    nav.addEventListener('click', e => { if (mobile.matches && e.target.closest('button')) setCollapsed(true); });
    home.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !home.classList.contains('sidebar-collapsed') && !document.querySelector('dialog[open]')) { setCollapsed(true); toggle.focus(); }
    });
    mobile.addEventListener('change', () => setCollapsed(mobile.matches || stored()));
}
