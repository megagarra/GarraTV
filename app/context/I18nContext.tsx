'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import {
    DEFAULT_LOCALE,
    LOCALES,
    LOCALE_COOKIE,
    SYSTEM_LOCALE,
    getMessages,
    isSupportedLocale,
    localeFromNavigator,
    resolveLocale,
    translate,
} from '../lib/i18n';

type Vars = Record<string, string | number>;

interface I18nState {
    /** Active BCP-47 locale tag. */
    locale: string;
    /** Every locale the app can switch to. */
    locales: { code: string; label: string }[];
    /** Translate a dot-path key, interpolating `{name}` placeholders. */
    t: (key: string, vars?: Vars) => string;
    /** A locale code, or `SYSTEM_LOCALE` to drop the saved choice and follow the system. */
    setLocale: (code: string) => void;
    /** True while no language was picked by hand, so the system language applies. */
    followsSystem: boolean;
}

const I18nContext = createContext<I18nState | undefined>(undefined);

// The API routes never read this — it only decides which bundled dictionary the
// client renders. Mirrored to localStorage for the packaged TV client, where the
// document origin can drop cookies (same reasoning as PROFILE_COOKIE_NAME).
function persistLocale(code: string) {
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=${oneYear}; SameSite=Lax`;
    try {
        localStorage.setItem(LOCALE_COOKIE, code);
    } catch {
        /* storage unavailable — the cookie alone is enough on the web */
    }
}

function clearSavedLocale() {
    document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    try {
        localStorage.removeItem(LOCALE_COOKIE);
    } catch {
        /* ignore */
    }
}

/** The hand-picked locale, if any, from the cookie or its localStorage mirror. */
function readSavedLocale(): string | null {
    const match = new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`).exec(document.cookie);
    if (match && isSupportedLocale(match[1])) return match[1];
    try {
        const stored = localStorage.getItem(LOCALE_COOKIE);
        if (isSupportedLocale(stored)) return stored;
    } catch {
        /* ignore */
    }
    return null;
}

export function I18nProvider({
    initialLocale,
    children,
}: {
    /** Read from the cookie server-side in the root layout, so the first paint matches. */
    initialLocale?: string;
    children: ReactNode;
}) {
    const [locale, setLocaleState] = useState(() => resolveLocale(initialLocale ?? DEFAULT_LOCALE));
    const [followsSystem, setFollowsSystem] = useState(true);

    // After hydration: a hand-picked locale wins; otherwise the system language.
    // The server already guessed from Accept-Language, but the packaged TV client
    // is never server-rendered, so navigator.languages is the source there.
    useEffect(() => {
        const saved = readSavedLocale();
        const next = saved ?? localeFromNavigator();
        setFollowsSystem(saved === null);
        if (next !== locale) {
            setLocaleState(next);
            document.documentElement.lang = next;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const messages = useMemo(() => getMessages(locale), [locale]);

    const t = useCallback(
        (key: string, vars?: Vars) => translate(messages, key, vars),
        [messages]
    );

    const setLocale = useCallback((code: string) => {
        let next: string;
        if (code === SYSTEM_LOCALE) {
            clearSavedLocale();
            next = localeFromNavigator();
            setFollowsSystem(true);
        } else {
            next = resolveLocale(code);
            persistLocale(next);
            setFollowsSystem(false);
        }
        setLocaleState(next);
        document.documentElement.lang = next;
    }, []);

    const value = useMemo<I18nState>(
        () => ({
            locale,
            locales: LOCALES.map(({ code, label }) => ({ code, label })),
            t,
            setLocale,
            followsSystem,
        }),
        [locale, t, setLocale, followsSystem]
    );

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
    const context = useContext(I18nContext);
    if (context === undefined) {
        throw new Error('useI18n must be used within an I18nProvider');
    }
    return context;
}

/** Shorthand for components that only need the translate function. */
export function useT() {
    return useI18n().t;
}
