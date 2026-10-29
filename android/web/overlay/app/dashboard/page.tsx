'use client';

/** Android replacement for app/dashboard/page.tsx: the redirect runs in the browser. */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardHomePage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/garratv/home/');
    }, [router]);

    return null;
}
