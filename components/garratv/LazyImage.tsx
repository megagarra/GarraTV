'use client';

import { memo, useEffect, useRef, useState } from 'react';

type Listener = (visible: boolean) => void;

// One observer for every image on the page instead of one per tile.
let observer: IntersectionObserver | null = null;
const listeners = new Map<Element, Listener>();

function observe(element: Element, listener: Listener): () => void {
    if (typeof IntersectionObserver === 'undefined') {
        listener(true);
        return () => undefined;
    }
    if (!observer) {
        observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) listeners.get(entry.target)?.(true);
            }
        }, { rootMargin: '400px 0px' });
    }
    listeners.set(element, listener);
    observer.observe(element);
    return () => {
        listeners.delete(element);
        observer?.unobserve(element);
    };
}

interface LazyImageProps {
    src: string;
    alt?: string;
    className?: string;
    onError?: () => void;
}

/**
 * Loads the picture only when it nears the viewport and fades it in once decoded.
 * `loading="lazy"` would do the first part, but Chrome 53 (webOS 4) ignores it and
 * fetches every image of the page at once.
 */
function LazyImage({ src, alt = '', className = '', onError }: LazyImageProps) {
    const holderRef = useRef<HTMLSpanElement>(null);
    const [visible, setVisible] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        const node = holderRef.current;
        if (!node || visible) return undefined;
        let stop: () => void = () => undefined;
        stop = observe(node, (isVisible) => {
            if (!isVisible) return;
            setVisible(true);
            stop();
        });
        return () => stop();
    }, [visible]);

    if (!visible) return <span ref={holderRef} className={`block ${className}`} />;

    return (
        <img
            src={src}
            alt={alt}
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={onError}
            className={`${className} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
    );
}

export default memo(LazyImage);
