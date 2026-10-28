// StreamFlix design tokens as Tailwind class strings. Focus states use :focus
// (never :focus-visible, missing before Chrome 86) so the remote always shows it.

/** Montserrat, loaded by app/streamflix/layout.tsx into --sf-display. */
export const display = '[font-family:var(--sf-display)]';

/** Dashboard tiles: red border, scale, brighten and lift on hover/focus. */
export const focusCard =
    'outline-none border-[3px] border-transparent transition duration-[250ms] ease-in-out hover:scale-105 focus:scale-105 hover:border-[#E50914] focus:border-[#E50914] hover:brightness-[1.18] focus:brightness-[1.18] hover:shadow-[0_24px_60px_rgba(0,0,0,0.7)] focus:shadow-[0_24px_60px_rgba(0,0,0,0.7)] hover:z-[2] focus:z-[2]';

/** Dashboard shortcuts. */
export const focusShortcut =
    'outline-none bg-[#1F1F1F] border-2 border-[#333333] rounded-[10px] transition duration-200 hover:scale-[1.04] focus:scale-[1.04] hover:border-[#E50914] focus:border-[#E50914] hover:bg-[#2A2A2A] focus:bg-[#2A2A2A]';

export const focusPoster =
    'outline-none border-2 border-transparent transition duration-[250ms] ease-in-out hover:scale-[1.08] focus:scale-[1.08] hover:border-[#E50914] focus:border-[#E50914] hover:shadow-[0_18px_40px_rgba(0,0,0,0.75)] focus:shadow-[0_18px_40px_rgba(0,0,0,0.75)] hover:z-[2] focus:z-[2]';

/** Login inputs (50px, #333). */
export const fieldClass =
    'w-full h-[50px] bg-[#333333] text-white text-[15px] rounded-md px-4 border border-[#333333] outline-none transition duration-200 focus:border-[#E50914] focus:shadow-[0_0_0_3px_rgba(229,9,20,0.25)] placeholder-[#8C8C8C]';

/** Sidebar search (44px, #1F1F1F, leading magnifier). */
export const searchField =
    'w-full h-11 bg-[#1F1F1F] text-white text-sm rounded-md pl-[42px] pr-[14px] border border-[#333333] outline-none transition-colors duration-200 focus:border-[#E50914] placeholder-[#8C8C8C]';

/** 40px round header button. */
export const iconButton =
    'w-10 h-10 flex-shrink-0 rounded-full bg-[#1F1F1F] border border-[#333333] flex items-center justify-center text-white outline-none transition-colors duration-200 hover:bg-[#2A2A2A] hover:border-[#E50914] focus:border-[#E50914] focus:shadow-[0_0_0_2px_#E50914]';

export const primaryButton =
    'bg-[#E50914] text-white rounded-md outline-none transition duration-200 hover:bg-[#B20710] focus:bg-[#B20710] focus:shadow-[0_0_0_3px_#ffffff] disabled:opacity-60';

export const ghostButton =
    'bg-[rgba(109,109,110,0.45)] text-white font-bold rounded-md outline-none transition duration-200 hover:bg-[rgba(109,109,110,0.7)] focus:bg-[rgba(109,109,110,0.7)] focus:shadow-[0_0_0_2px_#E50914]';

/** Segmented control wrapper and its buttons (list/grid, sort). */
export const segmented = 'flex p-[3px] bg-[#1F1F1F] border border-[#333333] rounded-md';

export function segmentButton(active: boolean): string {
    return [
        'rounded outline-none transition-colors duration-200 focus:shadow-[0_0_0_2px_#E50914]',
        active ? 'bg-[#333333] text-white' : 'text-[#8C8C8C] hover:text-white',
    ].join(' ');
}

/** Thin red-on-grey progress bar; `ratio` is 0..1. */
export function progressWidth(ratio: number): { width: string } {
    const clamped = Math.max(0, Math.min(1, ratio));
    return { width: `${Math.round(clamped * 100)}%` };
}

/** Deterministic dark gradient for items without artwork. */
export function placeholderGradient(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    return `linear-gradient(135deg, hsl(${hue}, 35%, 26%) 0%, #1F1F1F 70%)`;
}

export function initialsOf(name: string): string {
    // Plain ranges instead of \p{L}: Unicode property escapes need Chrome 64.
    const words = name.replace(/[^A-Za-z0-9À-ɏ ]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}
