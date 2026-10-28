import { redirect } from 'next/navigation';

interface RootPageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * StreamFlix is the default UI. Guests start on the free channels; signed-in
 * users are sent on to their home by that page.
 */
export default async function RootPage({ searchParams }: RootPageProps) {
    const params = await searchParams;
    const query = new URLSearchParams();
    for (const key of Object.keys(params)) {
        const value = params[key];
        if (typeof value === 'string') query.set(key, value);
    }
    const suffix = query.toString();
    // Query strings (e.g. ?deviceAuth=invalid) belong to the sign-in screen.
    redirect(suffix ? `/streamflix?${suffix}` : '/streamflix/free');
}
