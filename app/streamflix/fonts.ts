import { Manrope, Montserrat } from 'next/font/google';

// Shared by the StreamFlix layout and the /dashboard pages that wear its header.
// `--font-ui` is the token Tailwind's `font-sans` reads, so components that set
// the family explicitly get Manrope too.
export const manrope = Manrope({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700', '800'],
    display: 'swap',
    variable: '--font-ui',
});

export const montserrat = Montserrat({
    subsets: ['latin'],
    weight: ['700', '800', '900'],
    display: 'swap',
    variable: '--sf-display',
});
