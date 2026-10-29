import type { Config } from "tailwindcss";

/**
 * Tokens espelham `app/globals.css` (docs/redesign/00-design-system.md §3).
 * Nenhum hex literal deve aparecer em componentes — só aqui e no globals.
 */
const config: Config = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            screens: {
                // TVs a WebView sees as 960×540 (Google TV, Android TV) and phones on
                // their side: the 720px-tall layouts don't fit and need a compact variant.
                short: { raw: "(max-height: 640px)" },
                // Phones on their side (360–430 tall): a side rail instead of the header,
                // chips instead of the category column. Declared after `short`, so it wins.
                // Only phones get here, and their WebViews are modern: CSS grid is fine.
                phone: { raw: "(max-height: 430px)" },
            },
            colors: {
                bg: "var(--bg)",
                surface: {
                    DEFAULT: "var(--surface)",
                    2: "var(--surface-2)",
                    3: "var(--surface-3)",
                },
                line: {
                    DEFAULT: "var(--line)",
                    strong: "var(--line-strong)",
                },
                ink: {
                    DEFAULT: "var(--text)",
                    2: "var(--text-2)",
                    3: "var(--text-3)",
                },
                brand: {
                    DEFAULT: "var(--brand)",
                    strong: "var(--brand-strong)",
                    soft: "var(--brand-soft)",
                },
                ok: "var(--ok)",
                warn: "var(--warn)",

                // Aliases legados: mantidos só enquanto telas ainda não migradas
                // os referenciam. Removê-los quando as specs 02-06 concluírem.
                background: "var(--bg)",
                foreground: "var(--text)",
                primary: { DEFAULT: "var(--brand)", hover: "#f40612" },
                secondary: "var(--surface-2)",
                accent: "var(--surface-3)",
                "card-bg": "var(--surface)",
            },
            fontFamily: {
                sans: ["var(--font-ui)"],
                display: ["var(--sf-display, var(--font-ui))"],
                mono: ["var(--font-mono)"],
            },
        },
    },
    plugins: [],
};
export default config;
