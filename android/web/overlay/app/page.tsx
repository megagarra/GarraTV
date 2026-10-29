'use client';

/**
 * Android replacement for app/page.tsx: a static export cannot redirect on the
 * server, so the root forwards in the browser. The app always holds the account,
 * so it goes to the sign-in screen, which moves on to home once signed in.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RootPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace(`/garratv/${window.location.search}`);
    }, [router]);

    return null;
}
