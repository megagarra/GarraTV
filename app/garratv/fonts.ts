import localFont from 'next/font/local';

// Shared by the GarraTV layout and the /dashboard pages that wear its header.
// `--font-ui` is the token Tailwind's `font-sans` reads, so components that set
// the family explicitly get Manrope too.
//
// Static per-weight files (Google Fonts' latin subset, OFL), not next/font/google:
// Google serves both families as one variable font, and Chromium < 62 (webOS 4/5)
// ignores the weight axis and draws every weight at the thin default instance.
export const manrope = localFont({
    src: [
        { path: './fonts/manrope-400.woff2', weight: '400', style: 'normal' },
        { path: './fonts/manrope-500.woff2', weight: '500', style: 'normal' },
        { path: './fonts/manrope-600.woff2', weight: '600', style: 'normal' },
        { path: './fonts/manrope-700.woff2', weight: '700', style: 'normal' },
        { path: './fonts/manrope-800.woff2', weight: '800', style: 'normal' },
    ],
    display: 'swap',
    variable: '--font-ui',
});

export const montserrat = localFont({
    src: [
        { path: './fonts/montserrat-700.woff2', weight: '700', style: 'normal' },
        { path: './fonts/montserrat-800.woff2', weight: '800', style: 'normal' },
        { path: './fonts/montserrat-900.woff2', weight: '900', style: 'normal' },
    ],
    display: 'swap',
    variable: '--sf-display',
});
