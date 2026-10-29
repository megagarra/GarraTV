'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface WindowedRowsOptions {
    itemCount: number;
    /** Items rendered before the first measurement (and as a floor afterwards). */
    initialCount?: number;
    /** Extra viewport heights kept rendered above and below the visible area. */
    overscanScreens?: number;
    /** Called when the rendered window gets within this many rows of the loaded end. */
    nearEndRows?: number;
    onNearEnd?: () => void;
    /** Changes whenever the list is replaced (filter, sort), to re-measure from the top. */
    resetKey?: string;
}

export interface WindowedRows {
    /** Put on the element that wraps the rendered items (a flex-wrap grid or a column). */
    containerRef: (node: HTMLElement | null) => void;
    start: number;
    end: number;
    /** Heights of the spacers standing in for the rows that are not rendered. */
    topSpace: number;
    bottomSpace: number;
}

/**
 * The element that actually scrolls the list. It differs by breakpoint (the grid
 * column on desktop, the page body on mobile), and an `overflow-x: hidden` block
 * computes `overflow-y: auto` without ever scrolling, so only a box with content
 * taller than itself counts.
 */
function scrollParent(node: HTMLElement): HTMLElement | null {
    let current = node.parentElement;
    while (current) {
        const overflowY = window.getComputedStyle(current).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight + 1) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}

/**
 * Hook de virtualização sem dependências: mede a primeira célula renderizada,
 * deduz colunas e altura da linha e só mantém no DOM as linhas visíveis mais uma
 * folga, trocando o resto por espaçadores. Mantém a rolagem leve em TVs fracas e
 * deixa a navegação por setas sempre com um vizinho renderizado (a folga).
 */
export function useWindowedRows({
    itemCount,
    initialCount = 60,
    overscanScreens = 1,
    nearEndRows = 3,
    onNearEnd,
    resetKey = '',
}: WindowedRowsOptions): WindowedRows {
    const [node, setNode] = useState<HTMLElement | null>(null);
    const [range, setRange] = useState({ start: 0, end: Math.min(itemCount, initialCount), top: 0, bottom: 0 });
    const onNearEndRef = useRef(onNearEnd);
    const frameRef = useRef(0);

    useEffect(() => {
        onNearEndRef.current = onNearEnd;
    }, [onNearEnd]);

    const containerRef = useCallback((element: HTMLElement | null) => setNode(element), []);

    const measure = useCallback(() => {
        if (!node) return;
        const first = node.querySelector<HTMLElement>('[data-window-cell]');
        if (!first || first.offsetWidth === 0) {
            setRange((current) => (current.end >= Math.min(itemCount, initialCount) && current.start === 0
                ? current
                : { start: 0, end: Math.min(itemCount, initialCount), top: 0, bottom: 0 }));
            return;
        }
        const columns = Math.max(1, Math.round(node.clientWidth / first.offsetWidth));
        const rowHeight = first.offsetHeight || 1;
        const scroller = scrollParent(node);
        const viewport = scroller ? scroller.clientHeight : window.innerHeight;
        const offset = scroller
            ? node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
            : node.getBoundingClientRect().top + window.pageYOffset;
        const scrollTop = scroller ? scroller.scrollTop : window.pageYOffset;
        const overscan = viewport * overscanScreens;

        const totalRows = Math.ceil(itemCount / columns);
        const firstRow = Math.max(0, Math.floor((scrollTop - offset - overscan) / rowHeight));
        const lastRow = Math.min(totalRows - 1, Math.ceil((scrollTop - offset + viewport + overscan) / rowHeight));
        const start = firstRow * columns;
        const end = Math.max(Math.min(itemCount, (lastRow + 1) * columns), Math.min(itemCount, columns));

        setRange((current) => {
            const top = firstRow * rowHeight;
            const bottom = Math.max(0, (totalRows - lastRow - 1) * rowHeight);
            if (current.start === start && current.end === end && current.top === top && current.bottom === bottom) return current;
            return { start, end, top, bottom };
        });

        if (lastRow >= totalRows - 1 - nearEndRows) onNearEndRef.current?.();
    }, [node, itemCount, initialCount, overscanScreens, nearEndRows]);

    // New list: back to the first rows until the next measurement. Done during
    // render so the first paint of the new list never uses the old window.
    const [seenKey, setSeenKey] = useState(resetKey);
    if (seenKey !== resetKey) {
        setSeenKey(resetKey);
        setRange({ start: 0, end: Math.min(itemCount, initialCount), top: 0, bottom: 0 });
    }

    useEffect(() => {
        if (!node) return undefined;
        const schedule = () => {
            if (frameRef.current) return;
            frameRef.current = window.requestAnimationFrame(() => {
                frameRef.current = 0;
                measure();
            });
        };
        schedule();
        // Capture phase: scroll events don't bubble, and which box scrolls depends
        // on the breakpoint, so one document-level listener sees them all.
        document.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        return () => {
            document.removeEventListener('scroll', schedule, true);
            window.removeEventListener('resize', schedule);
            if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
            frameRef.current = 0;
        };
    }, [node, measure]);

    return { containerRef, start: range.start, end: range.end, topSpace: range.top, bottomSpace: range.bottom };
}
