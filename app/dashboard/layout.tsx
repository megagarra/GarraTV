import DashboardChrome from '@/components/garratv/DashboardChrome';
import { manrope, montserrat } from '@/app/garratv/fonts';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className={`${manrope.className} ${manrope.variable} ${montserrat.variable} antialiased`}>
            <DashboardChrome>{children}</DashboardChrome>
        </div>
    );
}
