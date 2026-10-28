'use client';

import { useState, useEffect, useCallback } from 'react';

interface UseInfiniteScrollOptions {
    initialBatchSize?: number;
    loadBatchSize?: number;
    threshold?: number;
}

export function useInfiniteScroll<T>(
    items: T[],
    {
        initialBatchSize = 40,
        loadBatchSize = 20,
        threshold = 0.1
    }: UseInfiniteScrollOptions = {}
) {
    const [visibleCount, setVisibleCount] = useState(initialBatchSize);
    const [sentinelNode, setSentinelNode] = useState<HTMLDivElement | null>(null);

    const [prevItems, setPrevItems] = useState(items);

    // Reset visible count when items change (e.g. after search or sort). Done during
    // render so the first paint of the new list already uses the reset count.
    if (items !== prevItems) {
        setPrevItems(items);
        // A background refresh swaps the array but should not jump the window
        // back to the first batch. An emptied list (filter change) does reset.
        setVisibleCount((current) => {
            if (items.length === 0 || current > items.length) return Math.min(initialBatchSize, items.length) || initialBatchSize;
            return current;
        });
    }

    const loadMore = useCallback(() => {
        setVisibleCount((prev) => Math.min(prev + loadBatchSize, items.length));
    }, [loadBatchSize, items.length]);

    // The catalog screens mount this node only after the full list is ready, so a
    // ref read inside an effect would miss it. The callback runs on attach.
    const sentinelRef = useCallback((node: HTMLDivElement | null) => {
        setSentinelNode(node);
    }, []);

    // Re-observing after each batch makes the observer fire again when the sentinel is
    // still on screen (tall viewports/TVs), since it only reports intersection transitions.
    useEffect(() => {
        if (!sentinelNode) return undefined;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMore();
                }
            },
            { threshold }
        );
        observer.observe(sentinelNode);

        return () => observer.disconnect();
    }, [loadMore, threshold, visibleCount, sentinelNode]);

    const visibleItems = items.slice(0, visibleCount);
    const hasMore = visibleCount < items.length;

    return {
        visibleItems,
        hasMore,
        sentinelRef
    };
}
