'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import Header from './Header';

interface ShellProps {
    children: React.ReactNode;
    /** Section name next to the wordmark; omitted on the dashboard. */
    title?: string;
    /** Where the back button goes; no button when omitted. */
    backHref?: string;
    /** Columns scroll on their own on desktop instead of the whole page. */
    fill?: boolean;
}

export default function Shell({ children, title, backHref, fill }: ShellProps) {
    const { isAuthenticated, isLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!isLoading && !isAuthenticated) router.replace('/streamflix/free');
    }, [isAuthenticated, isLoading, router]);

    if (isLoading || !isAuthenticated) {
        return <div className="min-h-screen bg-black" />;
    }

    // The header sits outside the scroll area instead of using position: sticky,
    // which webOS 4 (Chrome 53) ignores.
    return (
        <div className="h-screen flex flex-col bg-[#141414] text-white">
            <Header title={title} backHref={backHref} />
            <div className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${fill ? 'md:overflow-hidden' : ''}`}>
                {children}
            </div>
        </div>
    );
}
