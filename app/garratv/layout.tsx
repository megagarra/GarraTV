import { manrope, montserrat } from './fonts';

export default function GarraTVLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className={`${manrope.className} ${manrope.variable} ${montserrat.variable} min-h-screen bg-[#141414] text-white antialiased`}>
            {children}
        </div>
    );
}
