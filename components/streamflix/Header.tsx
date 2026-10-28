'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, LogOut, RefreshCw, Settings, User } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useData } from '@/app/context/DataContext';
import { useProfile } from '@/app/context/ProfileContext';
import { useI18n, useT } from '@/app/context/I18nContext';
import { display, iconButton } from './styles';

function formatExpiry(expDate: string | undefined, unlimited: string): string {
    if (!expDate || expDate === 'null' || expDate === '0') return unlimited;
    const seconds = Number(expDate);
    if (!Number.isFinite(seconds) || seconds <= 0) return unlimited;
    const date = new Date(seconds * 1000);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${date.getFullYear()}`;
}

export function Wordmark({ size = 'text-2xl' }: { size?: string }) {
    return (
        <span className={`${display} ${size} font-black uppercase tracking-[0.02em] text-[#E50914] leading-none`}>
            StreamFlix
        </span>
    );
}

interface HeaderProps {
    title?: string;
    backHref?: string;
}

export default function Header({ title, backHref }: HeaderProps) {
    const t = useT();
    const { locale } = useI18n();
    const { user, logout } = useAuth();
    const { syncData, isSyncing, syncProgress } = useData();
    const { profiles, activeProfile, selectProfile } = useProfile();
    const [now, setNow] = useState<Date | null>(null);
    const [accountOpen, setAccountOpen] = useState(false);

    useEffect(() => {
        // Clock starts after mount so server and client markup agree.
        const tick = () => setNow(new Date());
        const first = window.setTimeout(tick, 0);
        const timer = window.setInterval(tick, 15000);
        return () => {
            window.clearTimeout(first);
            window.clearInterval(timer);
        };
    }, []);

    const expiry = formatExpiry(user?.exp_date, t('common.unlimited'));
    const time = now ? now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
    const date = now ? now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }) : '';

    return (
        <header className="relative z-30 h-[72px] flex-shrink-0 flex items-center justify-between px-4 md:px-10 bg-black border-b border-[#222222]">
            <div className="flex items-center min-w-0 mr-3">
                {backHref && (
                    <Link href={backHref} data-focusable="true" data-own-focus="true" tabIndex={0} aria-label={t('streamflix.backHome')} className={`${iconButton} mr-3 md:mr-4`}>
                        <ArrowLeft size={18} />
                    </Link>
                )}
                <Link
                    href="/streamflix/home"
                    data-focusable="true"
                    data-own-focus="true"
                    tabIndex={0}
                    className="outline-none rounded focus:shadow-[0_0_0_2px_#E50914]"
                >
                    <Wordmark size="text-xl md:text-2xl" />
                </Link>
                {title && (
                    <div className="hidden md:flex items-center min-w-0 ml-4">
                        <span className="w-px h-6 bg-[#333333] mr-4" />
                        <span className={`${display} text-sm font-bold uppercase tracking-[0.12em] whitespace-nowrap truncate`}>{title}</span>
                    </div>
                )}
            </div>

            <div className="flex items-center">
                <div className="hidden min-[1100px]:flex items-center mr-[18px]">
                    <div className="flex flex-col items-end mr-[18px]">
                        <span className="text-base font-extrabold tabular-nums leading-tight">{time}</span>
                        <span className="text-xs text-[#B3B3B3] whitespace-nowrap capitalize">{date}</span>
                    </div>
                    <div className="h-8 flex items-center px-3 border border-[#333333] rounded-2xl text-[13px] text-[#B3B3B3] whitespace-nowrap">
                        {t('streamflix.expiresLabel')}
                        <strong className="text-white ml-1.5">{expiry}</strong>
                    </div>
                </div>
                <button
                    type="button"
                    data-focusable="true"
                    data-own-focus="true"
                    tabIndex={0}
                    onClick={() => syncData()}
                    disabled={isSyncing}
                    aria-label={isSyncing ? t('streamflix.syncing', { n: syncProgress }) : t('streamflix.refresh')}
                    title={isSyncing ? t('streamflix.syncing', { n: syncProgress }) : t('streamflix.refresh')}
                    className={`${iconButton} mr-2 md:mr-2.5 disabled:opacity-60`}
                >
                    <RefreshCw size={18} className={isSyncing ? 'animate-spin' : ''} />
                </button>
                <div className="relative mr-2 md:mr-2.5">
                    <button
                        type="button"
                        data-focusable="true"
                        data-own-focus="true"
                        tabIndex={0}
                        onClick={() => setAccountOpen((open) => !open)}
                        aria-label={t('streamflix.account')}
                        aria-expanded={accountOpen}
                        className={iconButton}
                    >
                        <User size={18} />
                    </button>
                    {accountOpen && (
                        <div className="absolute right-0 top-full mt-3 w-72 bg-[#1F1F1F] border border-[#333333] rounded-lg p-5 z-40 shadow-[0_24px_60px_rgba(0,0,0,0.7)]">
                            <p className={`${display} font-extrabold text-white truncate`}>{activeProfile?.name || user?.username}</p>
                            {user?.username && <p className="text-sm text-[#B3B3B3] mt-1 truncate">{user.username}</p>}
                            {user?.status && <p className="text-sm text-[#B3B3B3] mt-1">{t('streamflix.status', { status: user.status })}</p>}
                            {user && (
                                <p className="text-sm text-[#B3B3B3] mt-1">
                                    {t('streamflix.connections', { active: user.active_cons, max: user.max_connections })}
                                </p>
                            )}
                            <p className="text-sm text-[#B3B3B3] mt-1">{t('streamflix.expires', { date: expiry })}</p>
                            {profiles.length > 1 && (
                                <div className="mt-4 space-y-1">
                                    {profiles.map((profile) => {
                                        const active = profile.id === activeProfile?.id;
                                        return (
                                            <button
                                                key={profile.id}
                                                type="button"
                                                data-focusable="true"
                                                data-own-focus="true"
                                                tabIndex={0}
                                                onClick={() => selectProfile(profile.id)}
                                                className={[
                                                    'relative w-full h-10 text-left pl-[18px] pr-3 rounded text-sm outline-none transition-colors duration-200 hover:bg-[#2A2A2A] focus:bg-[#2A2A2A] focus:shadow-[inset_0_0_0_2px_#E50914]',
                                                    active ? 'bg-[#2A2A2A] font-bold text-white' : 'text-[#B3B3B3]',
                                                ].join(' ')}
                                            >
                                                {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-sm bg-[#E50914]" />}
                                                {profile.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            <button
                                type="button"
                                data-focusable="true"
                                data-own-focus="true"
                                tabIndex={0}
                                onClick={() => logout('/streamflix')}
                                className="mt-4 w-full h-10 flex items-center justify-center rounded-md bg-[rgba(109,109,110,0.45)] text-sm font-bold outline-none transition-colors duration-200 hover:bg-[rgba(109,109,110,0.7)] focus:shadow-[0_0_0_2px_#E50914]"
                            >
                                <LogOut size={16} className="mr-2" />
                                {t('streamflix.logout')}
                            </button>
                        </div>
                    )}
                </div>
                <Link
                    href="/dashboard/settings"
                    data-focusable="true"
                    data-own-focus="true"
                    tabIndex={0}
                    aria-label={t('streamflix.settings')}
                    className={iconButton}
                >
                    <Settings size={18} />
                </Link>
            </div>
        </header>
    );
}
