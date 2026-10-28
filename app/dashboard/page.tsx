import { redirect } from 'next/navigation';

/** The StreamFlix home replaced this page; the other /dashboard routes stay. */
export default function DashboardHomePage() {
    redirect('/streamflix/home');
}
