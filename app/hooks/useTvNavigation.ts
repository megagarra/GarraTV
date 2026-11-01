import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useNavigationContext } from '@/app/context/NavigationContext';
import { isBackKey } from '@/app/lib/platform/keys';

export const useTvNavigation = () => {
    const router = useRouter();
    const { getActiveBackHandler } = useNavigationContext();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const activeElement = document.activeElement;
            const isFormControl = activeElement instanceof HTMLInputElement ||
                activeElement instanceof HTMLTextAreaElement ||
                activeElement instanceof HTMLSelectElement;

            // Backspace inside a text field erases text — even once the field is empty,
            // so holding it down never navigates away. The remote's Back key arrives
            // with its own codes (see isBackKey) and still leaves the field.
            if (e.key === 'Backspace' && isTextEntry(activeElement)) return;

            const isBack = isBackKey(e);

            // Only handle navigation keys
            if (!isBack && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) {
                return;
            }

            // A focused field keeps only the keys that still do something inside
            // it. The vertical arrows never belong to it: a remote has no Tab key
            // and no pointer, so a field that swallows them is a dead end. The
            // horizontal arrows belong to a text field only while the caret has
            // somewhere left to go; at the edge they pass to the navigation,
            // which is what lets a remote cross a row of fields such as the
            // pairing form's code, name, profile and confirm button.
            // Back is never the field's: it must leave even a range or a select.
            if (isFormControl && !isBack && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
                // Enter belongs to the field: it submits, or opens a select.
                if (e.key === 'Enter') return;
                // A range is adjusted with the horizontal arrows and is never a
                // trap, since the vertical ones still move focus out of it.
                if (activeElement instanceof HTMLInputElement && activeElement.type === 'range') return;
                if (isTextEntry(activeElement) && !isCaretAtEdge(activeElement, e.key)) return;
            }

            // Back Navigation
            if (isBack) {
                e.preventDefault();
                if (document.fullscreenElement) {
                    return;
                }

                // Check if there's a custom back handler registered
                const customHandler = getActiveBackHandler();
                if (customHandler) {
                    console.log('TVNavigation::Using custom back handler');
                    customHandler();
                } else {
                    console.log('TVNavigation::Using default router.back()');
                    router.back();
                }
                return;
            }

            // Directional Navigation
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                // If the focused element is a carousel, let ArrowLeft/ArrowRight be
                // handled by the component itself (it will preventDefault internally)
                const isCarousel = activeElement?.getAttribute('data-carousel') === 'true';
                if (isCarousel && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    return;
                }
                e.preventDefault();
                handleDirectionalNav(e.key, e.repeat);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [router, getActiveBackHandler]);
};

const TEXT_ENTRY_INPUT_TYPES = ['text', 'search', 'password', 'email', 'url', 'tel', 'number'];

/** A field where the horizontal arrows drive a caret, unlike a range or a select. */
function isTextEntry(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
    if (el instanceof HTMLTextAreaElement) return true;
    return el instanceof HTMLInputElement && TEXT_ENTRY_INPUT_TYPES.indexOf(el.type) !== -1;
}

/**
 * True when the caret has nowhere left to go, so the key press belongs to the
 * navigation. Types that expose no selection (number, email) report null or
 * throw; treating those as "at the edge" keeps the field crossable instead of
 * trapping the cursor inside it.
 */
function isCaretAtEdge(el: HTMLInputElement | HTMLTextAreaElement, key: string): boolean {
    let start: number | null;
    let end: number | null;
    try {
        start = el.selectionStart;
        end = el.selectionEnd;
    } catch {
        return true;
    }

    if (start === null || end === null) return true;
    // A range selection still has somewhere to collapse to.
    if (start !== end) return false;

    return key === 'ArrowLeft' ? start === 0 : start === el.value.length;
}

// Holding a directional key on a TV remote fires a burst of auto-repeat
// keydown events, and each one triggers a full querySelectorAll +
// getBoundingClientRect scan over every focusable element (160+ on the home
// screen), which stutters on weak TV CPUs. Auto-repeat is rate limited to one
// scan per NAV_REPEAT_MIN_INTERVAL_MS; deliberate presses always run, since
// dropping one of those would lose input the user meant to give us.
const NAV_REPEAT_MIN_INTERVAL_MS = 100;
let navLastExecTime = 0;

function handleDirectionalNav(direction: string, isAutoRepeat: boolean) {
    const now = performance.now();

    if (isAutoRepeat && now - navLastExecTime < NAV_REPEAT_MIN_INTERVAL_MS) {
        return;
    }

    navLastExecTime = now;
    runDirectionalNav(direction);
}

function runDirectionalNav(direction: string) {
    const focusableElements = Array.from(document.querySelectorAll('[data-focusable="true"]')) as HTMLElement[];
    const activeElement = document.activeElement as HTMLElement | null;

    // The origin only has to be *somewhere on screen*, not a registered target.
    // A field that never got `data-focusable` is still a real position to move
    // away from, and jumping to the first element of the page instead would
    // throw the cursor across the screen when the user simply pressed up.
    const hasOrigin = activeElement instanceof HTMLElement && activeElement !== document.body;

    if (!hasOrigin) {
        // Nothing focused yet — start at the first focusable element.
        if (focusableElements.length > 0) {
            focusableElements[0].focus();
        }
        return;
    }

    const currentRect = activeElement.getBoundingClientRect();
    const isVertical = direction === 'ArrowUp' || direction === 'ArrowDown';
    const threshold = 5; // 5px threshold for overlap/alignment

    // Candidates that share the current element's span on the cross axis are in
    // the same column (going up/down) or the same row (going left/right), and
    // always win over one that merely happens to be close. Among those, the
    // nearest row (or column) comes first and only then the best-centered item
    // in it: a full-width row (an episode) shares its span with everything above,
    // so ranking by centre distance alone skipped the season picker and the
    // title's buttons and landed in the header.
    const aligned: { el: HTMLElement; gap: number; cross: number }[] = [];
    let bestLoose: HTMLElement | null = null;
    let bestLooseDistance = Infinity;
    // The top bar is reached only once nothing in the content lies that way:
    // its buttons sit right above whatever is on the right edge (the season
    // picker), so going up from there skipped the title's own buttons.
    const fromContent = !activeElement.closest('header');
    let bestHeader: HTMLElement | null = null;
    let bestHeaderDistance = Infinity;

    focusableElements.forEach((el) => {
        if (el === activeElement) return;

        const rect = el.getBoundingClientRect();

        // A hidden element reports a zero rect at the origin, which would make it
        // the nearest thing above and to the left of everything.
        if (rect.width === 0 && rect.height === 0) return;

        // How far ahead the candidate starts, along the direction of travel.
        let gap: number;
        switch (direction) {
            case 'ArrowUp':
                gap = currentRect.top - rect.bottom;
                break;
            case 'ArrowDown':
                gap = rect.top - currentRect.bottom;
                break;
            case 'ArrowLeft':
                gap = currentRect.left - rect.right;
                break;
            default:
                gap = rect.left - currentRect.right;
        }
        if (gap < -threshold) return;

        const currentCenter = { x: currentRect.left + currentRect.width / 2, y: currentRect.top + currentRect.height / 2 };
        const candidateCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

        const dx = Math.abs(candidateCenter.x - currentCenter.x);
        const dy = Math.abs(candidateCenter.y - currentCenter.y);

        const isAligned = isVertical
            ? rect.left < currentRect.right && rect.right > currentRect.left
            : rect.top < currentRect.bottom && rect.bottom > currentRect.top;

        if (fromContent && el.closest('header')) {
            const distance = isVertical ? dy + (dx * 2) : dx + (dy * 2);
            if (distance < bestHeaderDistance) {
                bestHeaderDistance = distance;
                bestHeader = el;
            }
            return;
        }

        if (isAligned) {
            aligned.push({ el, gap: Math.max(0, gap), cross: isVertical ? dx : dy });
            return;
        }

        // Primary axis first, cross-axis deviation as a penalty.
        const distance = isVertical ? dy + (dx * 2) : dx + (dy * 2);
        if (distance < bestLooseDistance) {
            bestLooseDistance = distance;
            bestLoose = el;
        }
    });

    // Nearest row/column ahead, then the best-centered element within it.
    let bestAligned: HTMLElement | null = null;
    if (aligned.length > 0) {
        const nearestGap = aligned.reduce((min, c) => Math.min(min, c.gap), Infinity);
        let bestCross = Infinity;
        aligned.forEach((c) => {
            if (c.gap <= nearestGap + ROW_TOLERANCE_PX && c.cross < bestCross) {
                bestCross = c.cross;
                bestAligned = c.el;
            }
        });
    }

    // Only leave the current column/row when nothing in it lies ahead.
    // The cast mirrors the original code: TypeScript narrows both to `never`
    // because it cannot see the assignments made inside the forEach closure.
    const target = (bestAligned ?? bestLoose ?? bestHeader) as HTMLElement | null;
    if (target) {
        target.focus();
        reveal(target, direction === 'ArrowUp');
    }
}

/** Elements this close along the travel axis count as one row (or column). */
const ROW_TOLERANCE_PX = 12;
/** Room kept between a focused element and the edge of what scrolls it. */
const REVEAL_MARGIN_PX = 24;

function scrollParentOf(el: HTMLElement): HTMLElement | null {
    for (let node = el.parentElement; node; node = node.parentElement) {
        const style = window.getComputedStyle(node);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
        // A fixed layer (player controls, a modal) does not move with the page behind it.
        if (style.position === 'fixed') return null;
    }
    return (document.scrollingElement as HTMLElement | null) ?? null;
}

/**
 * Keeps the focused element whole on screen; focus() alone leaves one cut by the
 * edge of its scroll area. Going up to something that fits on the first screen
 * scrolls back to the very top, so the title and poster above the buttons show
 * again. Done by hand: scrollIntoView options need Chrome 61 (webOS 4 is 53).
 */
function reveal(el: HTMLElement, goingUp: boolean) {
    const parent = scrollParentOf(el);
    if (!parent) return;
    const isPage = parent === document.scrollingElement;
    const view = isPage ? { top: 0, bottom: window.innerHeight } : parent.getBoundingClientRect();
    const rect = el.getBoundingClientRect();

    if (goingUp) {
        const fromContentTop = rect.bottom - view.top + parent.scrollTop;
        if (fromContentTop + REVEAL_MARGIN_PX <= parent.clientHeight) {
            parent.scrollTop = 0;
            return;
        }
    }
    if (rect.top < view.top + REVEAL_MARGIN_PX) {
        parent.scrollTop -= view.top + REVEAL_MARGIN_PX - rect.top;
    } else if (rect.bottom > view.bottom - REVEAL_MARGIN_PX) {
        parent.scrollTop += rect.bottom - (view.bottom - REVEAL_MARGIN_PX);
    }
}
