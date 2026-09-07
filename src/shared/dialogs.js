export function installDialogBehavior() {
    const dialogs = [...document.querySelectorAll('.md3-modal-overlay, .modal')];
    const visible = node => getComputedStyle(node).display !== 'none';
    const focusable = node => [...node.querySelectorAll('button, input, textarea, select, [tabindex="0"]')]
        .filter(control => !control.disabled && control.getClientRects().length);
    let lastExternalFocus = document.activeElement;
    document.addEventListener('focusin', event => {
        if (!dialogs.some(dialog => dialog.contains(event.target))) lastExternalFocus = event.target;
    });
    for (const dialog of dialogs) {
        let wasOpen = false;
        let opener;
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        const heading = dialog.querySelector('h3');
        if (heading) {
            heading.id ||= `${dialog.id}Heading`;
            dialog.setAttribute('aria-labelledby', heading.id);
        }
        new MutationObserver(() => {
            const open = visible(dialog);
            if (open === wasOpen) return;
            wasOpen = open;
            if (open) {
                opener = lastExternalFocus;
                if (!dialog.contains(document.activeElement)) focusable(dialog)[0]?.focus({ preventScroll: true });
            } else if (opener?.getClientRects().length) opener.focus({ preventScroll: true });
            document.body.style.overflow = dialogs.some(visible) || visible(document.getElementById('mistakeView')) ? 'hidden' : '';
        }).observe(dialog, { attributes: true, attributeFilter: ['style'] });
    }
    document.addEventListener('keydown', event => {
        const dialog = dialogs.find(visible);
        if (!dialog) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            const dismiss = dialog.querySelector('.modal-close, #archiveCancelBtn, #errataCancelBtn');
            dismiss?.click();
        } else if (event.key === 'Tab') {
            const controls = focusable(dialog);
            const first = controls[0], last = controls.at(-1);
            if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
                event.preventDefault(); (event.shiftKey ? last : first)?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first?.focus();
            }
        }
    });
}
