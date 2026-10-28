import DashboardChrome from '@/components/streamflix/DashboardChrome';
import { manrope, montserrat } from '@/app/streamflix/fonts';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className={`${manrope.className} ${manrope.variable} ${montserrat.variable} antialiased`}>
            <DashboardChrome>{children}</DashboardChrome>
        </div>
    );
}
