import { redirect } from 'next/navigation';

/** The GarraTV home replaced this page; the other /dashboard routes stay. */
export default function DashboardHomePage() {
    redirect('/garratv/home');
}
