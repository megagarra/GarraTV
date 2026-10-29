'use client';

/**
 * `useParams` for the static export. Every dynamic page is exported once, under
 * the placeholder `_`, and the shell serves that file for any id — so Next's own
 * params would always say `_`. The real values are read back from the URL.
 */
import { usePathname } from 'next/navigation';
import { PAGE_ROUTES } from './pageRoutes.generated';

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
    const pathname = usePathname() || '';
    const clean = pathname.replace(/\/+$/, '');
    for (const route of PAGE_ROUTES) {
        const match = route.pattern.exec(clean);
        if (!match) continue;
        const params: Record<string, string> = {};
        route.keys.forEach((key, index) => {
            params[key] = decodeURIComponent(match[index + 1]);
        });
        return params as T;
    }
    return {} as T;
}
