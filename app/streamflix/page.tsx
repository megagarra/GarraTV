'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Tv } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useT } from '@/app/context/I18nContext';
import * as db from '@/app/lib/db';
import { display, fieldClass, ghostButton, primaryButton } from '@/components/streamflix/styles';
import { Wordmark } from '@/components/streamflix/Header';

const MOSAIC_SIZE = 40;

export default function StreamflixLoginPage() {
    const t = useT();
    const router = useRouter();
    const { login, isAuthenticated, isLoading } = useAuth();
    const [hostUrl, setHostUrl] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [covers, setCovers] = useState<string[]>([]);

    useEffect(() => {
        if (!isLoading && isAuthenticated) router.replace('/streamflix/home');
    }, [isAuthenticated, isLoading, router]);

    useEffect(() => {
        let cancelled = false;
        const loadCovers = async () => {
            try {
                const streams = await db.listStreams('movie', undefined, MOSAIC_SIZE, 0, 'rating');
                const urls = streams
                    .map((stream) => stream.cover || stream.icon)
                    .filter((url): url is string => Boolean(url));
                if (!cancelled) setCovers(urls);
            } catch (err) {
                console.error('[StreamFlix] Login backdrop unavailable', err);
            }
        };
        loadCovers();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (isLoading || isAuthenticated) return;
        document.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus();
    }, [isLoading, isAuthenticated]);

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            await login(hostUrl.trim(), username.trim(), password, '/streamflix/home');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t('login.failed'));
        } finally {
            setSubmitting(false);
        }
    };

    if (isLoading || isAuthenticated) {
        return <div className="min-h-screen bg-black" />;
    }

    // An empty cache still gets the mosaic texture, from tinted tiles.
    const tiles: (string | null)[] = [];
    for (let i = 0; i < MOSAIC_SIZE; i++) tiles.push(covers.length ? covers[i % covers.length] : null);

    return (
        <div className="relative min-h-screen overflow-hidden bg-black flex flex-col items-center px-5 pt-7 pb-14">
            <div
                aria-hidden="true"
                className="absolute -top-[60px] -right-[60px] -bottom-[60px] -left-[60px] flex flex-wrap content-start"
                style={{ filter: 'blur(5px)', transform: 'rotate(-4deg) scale(1.15)' }}
            >
                {tiles.map((url, index) => (
                    <div key={index} className="w-1/4 md:w-[12.5%] p-1.5">
                        <div
                            className="ratio ratio-poster rounded-md overflow-hidden"
                            style={{ background: `linear-gradient(135deg, hsl(${(index * 47) % 360}, 30%, 22%), #141414)` }}
                        >
                            {url && <img src={url} alt="" className="ratio-fill object-cover" />}
                        </div>
                    </div>
                ))}
            </div>
            <div className="absolute top-0 right-0 bottom-0 left-0 bg-[rgba(0,0,0,0.8)]" />
            <div
                className="absolute top-0 right-0 bottom-0 left-0"
                style={{ background: 'radial-gradient(ellipse at center, transparent 25%, rgba(0,0,0,0.9) 100%)' }}
            />

            <div className="relative w-full max-w-[1240px]">
                <Wordmark size="text-[34px]" />
            </div>

            <form
                onSubmit={onSubmit}
                className="relative mt-[7vh] w-full max-w-[450px] bg-[#141414] rounded-lg border border-[#262626] px-6 pt-9 pb-8 sm:px-11 sm:pt-11 sm:pb-9 shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
            >
                <h1 className={`${display} text-[28px] font-extrabold leading-tight`}>{t('streamflix.loginTitle')}</h1>
                <p className="mt-1.5 text-sm text-[#B3B3B3]">{t('streamflix.loginSubtitle')}</p>

                <div className="mt-[22px] space-y-4">
                    <label className="block">
                        <span className="block mb-2 text-[13px] font-semibold text-[#B3B3B3]">{t('streamflix.serverUrl')}</span>
                        <input
                            type="url"
                            required
                            value={hostUrl}
                            onChange={(event) => setHostUrl(event.target.value)}
                            placeholder={t('streamflix.serverPlaceholder')}
                            className={fieldClass}
                            data-focusable="true"
                            data-own-focus="true"
                            data-initial-focus="true"
                        />
                    </label>
                    <label className="block">
                        <span className="block mb-2 text-[13px] font-semibold text-[#B3B3B3]">{t('streamflix.username')}</span>
                        <input
                            required
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            placeholder={t('streamflix.usernamePlaceholder')}
                            className={fieldClass}
                            data-focusable="true"
                            data-own-focus="true"
                            autoComplete="username"
                        />
                    </label>
                    <label className="block">
                        <span className="block mb-2 text-[13px] font-semibold text-[#B3B3B3]">{t('streamflix.password')}</span>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                required
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                placeholder="••••••••"
                                className={`${fieldClass} pr-[52px]`}
                                data-focusable="true"
                                data-own-focus="true"
                                autoComplete="current-password"
                            />
                            <button
                                type="button"
                                data-focusable="true"
                                data-own-focus="true"
                                tabIndex={0}
                                onClick={() => setShowPassword((value) => !value)}
                                aria-label={showPassword ? t('streamflix.hidePassword') : t('streamflix.showPassword')}
                                className="absolute right-1.5 top-[5px] w-10 h-10 rounded flex items-center justify-center text-[#B3B3B3] outline-none transition-colors duration-200 hover:text-white hover:bg-[#2A2A2A] focus:text-white focus:shadow-[0_0_0_2px_#E50914]"
                            >
                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                    </label>
                </div>

                {error && <p className="mt-4 text-sm text-[#E50914]">{error}</p>}

                <button
                    type="submit"
                    data-focusable="true"
                    data-own-focus="true"
                    disabled={submitting}
                    className={`${primaryButton} ${display} mt-7 w-full h-[52px] text-[15px] font-extrabold tracking-[0.14em] uppercase`}
                >
                    {submitting ? t('streamflix.entering') : t('streamflix.enter')}
                </button>

                <div className="mt-7 pt-6 border-t border-[#262626]">
                    <p className="text-sm text-[#B3B3B3]">{t('streamflix.noAccountYet')}</p>
                    <Link
                        href="/streamflix/free"
                        data-focusable="true"
                        data-own-focus="true"
                        className={`${ghostButton} mt-3 w-full h-[52px] flex items-center justify-center text-[15px]`}
                    >
                        <Tv size={20} className="mr-2.5" />
                        {t('streamflix.watchFree')}
                    </Link>
                </div>
            </form>
        </div>
    );
}
