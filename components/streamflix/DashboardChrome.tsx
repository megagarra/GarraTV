'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Loader from '@/components/Loader';
import { useAuth } from '@/app/context/AuthContext';
import { useT } from '@/app/context/I18nContext';
import { useAutoFocusMainContent } from '@/app/hooks/useAutoFocusMainContent';
import Header from './Header';

// The /dashboard pages StreamFlix still links to, titled in its header.
const TITLES: [string, string][] = [
    ['/dashboard/search', 'nav.search'],
    ['/dashboard/tv', 'nav.tvMode'],
    ['/dashboard/settings', 'nav.settings'],
    ['/dashboard/favorites', 'nav.myList'],
    ['/dashboard/live', 'nav.live'],
    ['/dashboard/movies', 'nav.movies'],
    ['/dashboard/series', 'nav.series'],
];

/** StreamFlix header around the remaining /dashboard routes; players get the full screen. */
export default function DashboardChrome({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, isLoading } = useAuth();
    const t = useT();
    const router = useRouter();
    const pathname = usePathname() ?? '';
    const mainRef = useRef<HTMLElement>(null);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            router.push('/streamflix/free');
        }
    }, [isAuthenticated, isLoading, router]);

    useAutoFocusMainContent(mainRef);

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#141414] text-white">
                <Loader />
            </div>
        );
    }

    if (!isAuthenticated) return null;

    if (pathname.indexOf('/dashboard/watch/') === 0) {
        return <div className="min-h-screen bg-black">{children}</div>;
    }

    const match = TITLES.find(([prefix]) => pathname.indexOf(prefix) === 0);

    return (
        <div className="h-screen flex flex-col bg-[#141414] text-white overflow-hidden">
            <Header title={match ? t(match[1]) : undefined} backHref="/streamflix/home" />
            <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto">
                <div className="max-w-[1800px] mx-auto min-h-full">{children}</div>
            </main>
        </div>
    );
}
