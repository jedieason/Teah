const mobile = () => matchMedia('(max-width: 700px)').matches;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const isMobileFlash = mobile;

export function resetMobileFlashSwipe(stage) {
    if (!stage) return;
    stage.classList.remove('swipe-dragging', 'swipe-exiting');
    stage.style.setProperty('--swipe-x', '0px');
    stage.style.setProperty('--swipe-angle', '0deg');
    stage.style.setProperty('--swipe-feedback', '0');
    stage.parentElement?.style.setProperty('--swipe-progress', '0');
}

export async function animateMobileFlashExit(stage, direction, track) {
    if (!stage || !mobile() || reducedMotion()) return;
    // Flush the drag position before transitioning from it to the edge of the screen.
    stage.getBoundingClientRect();
    stage.classList.remove('swipe-dragging');
    stage.classList.add('swipe-exiting');
    stage.dataset.swipe = track ? direction > 0 ? 'known' : 'learning' : '';
    stage.style.setProperty('--swipe-feedback', track ? '1' : '0');
    stage.style.setProperty('--swipe-x', `${direction * (innerWidth + stage.offsetWidth)}px`);
    stage.style.setProperty('--swipe-angle', `${direction * 18}deg`);
    stage.parentElement.style.setProperty('--swipe-progress', '1');
    await new Promise(resolve => {
        const finish = event => {
            if (event && (event.target !== stage || event.propertyName !== 'transform')) return;
            clearTimeout(timeout); stage.removeEventListener('transitionend', finish); resolve();
        };
        const timeout = setTimeout(finish, 340);
        stage.addEventListener('transitionend', finish);
    });
}

export function bindMobileFlashSwipe(stage, { blocked, tracking, preview, swipe }) {
    let down = null, suppressClick = false;
    const release = pointerId => { if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId); };
    const cancel = () => {
        if (!down) return;
        const { pointerId, dragging } = down; down = null;
        suppressClick ||= dragging; release(pointerId); resetMobileFlashSwipe(stage);
    };
    stage.addEventListener('pointerdown', event => {
        if (!mobile() || blocked() || !event.isPrimary || event.button !== 0 || event.target.closest('.vocab-card-actions')) return;
        suppressClick = false;
        down = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false, direction: 0 };
        stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener('pointermove', event => {
        if (!down || event.pointerId !== down.pointerId) return;
        if (!mobile() || blocked()) { cancel(); return; }
        const x = event.clientX - down.x, y = event.clientY - down.y;
        if (!down.dragging) {
            if (Math.max(Math.abs(x), Math.abs(y)) < 8) return;
            if (Math.abs(y) >= Math.abs(x)) { cancel(); return; }
            down.dragging = true; stage.classList.add('swipe-dragging');
        }
        const direction = Math.sign(x);
        if (direction !== down.direction) { down.direction = direction; preview(direction); }
        const progress = clamp(Math.abs(x) / (stage.offsetWidth * .3), 0, 1);
        stage.dataset.swipe = tracking() ? direction > 0 ? 'known' : 'learning' : '';
        stage.style.setProperty('--swipe-x', reducedMotion() ? '0px' : `${x}px`);
        stage.style.setProperty('--swipe-angle', reducedMotion() ? '0deg' : `${clamp(x / stage.offsetWidth * 18, -18, 18)}deg`);
        stage.style.setProperty('--swipe-feedback', tracking() ? String(progress) : '0');
        stage.parentElement.style.setProperty('--swipe-progress', String(progress));
    });
    stage.addEventListener('pointerup', event => {
        if (!down || event.pointerId !== down.pointerId) return;
        const x = event.clientX - down.x, y = event.clientY - down.y;
        const threshold = clamp(stage.offsetWidth * .24, 60, 110);
        const { pointerId, dragging } = down; down = null; release(pointerId);
        suppressClick = dragging || Math.abs(x) >= threshold;
        if (mobile() && !blocked() && Math.abs(x) >= threshold && Math.abs(x) > Math.abs(y) * 1.2) swipe(Math.sign(x));
        else resetMobileFlashSwipe(stage);
    });
    stage.addEventListener('pointercancel', cancel);
    stage.addEventListener('lostpointercapture', cancel);
    stage.addEventListener('click', event => {
        if (!suppressClick || event.detail === 0) return;
        event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
    }, true);
}
