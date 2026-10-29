'use client';
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import * as db from '../lib/db';
import { apiFetch } from '../lib/apiClient';
import { useT } from './I18nContext';

interface UserInfo {
    username: string;
    status: string;
    exp_date: string;
    active_cons: string;
    max_connections: string;
}

interface ServerInfo {
    url: string;
    port: string;
    https_port: string;
    server_protocol: string;
    rtmp_port: string;
    timezone: string;
    timestamp_now: number;
    time_now: string;
}

/**
 * What the browser keeps about the account. The provider credentials live only on
 * the server; the session is an httpOnly cookie this code never sees.
 */
interface StoredAuthData {
    user: UserInfo;
    server: ServerInfo;
}

interface ConfigResponse {
    authenticated?: boolean;
    user?: UserInfo;
    server?: ServerInfo;
}

interface AuthState {
    user: UserInfo | null;
    server: ServerInfo | null;
    isAuthenticated: boolean;
    login: (serverUrl: string, user: string, pass: string, redirectTo?: string) => Promise<void>;
    logout: (redirectTo?: string) => void;
    isLoading: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const AUTH_STORAGE_KEY = 'garratv_auth';

function storeAuth(data: StoredAuthData | null) {
    try {
        if (data) {
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: data.user, server: data.server }));
        } else {
            localStorage.removeItem(AUTH_STORAGE_KEY);
        }
    } catch (e) {
        console.warn('Failed to update stored auth', e);
    }
}

function readStoredAuth(): StoredAuthData | null {
    try {
        const stored = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!stored) return null;

        const parsed = JSON.parse(stored) as Partial<StoredAuthData> & { credentials?: unknown };
        if (!parsed.user || !parsed.server) {
            localStorage.removeItem(AUTH_STORAGE_KEY);
            return null;
        }

        // Older builds cached the provider password here (and Xtream echoes it inside
        // user_info); rewrite the entry so it no longer sits in the browser.
        const user = { ...parsed.user } as UserInfo & { password?: unknown };
        if (parsed.credentials !== undefined || user.password !== undefined) {
            delete user.password;
            storeAuth({ user, server: parsed.server });
        }

        return { user, server: parsed.server };
    } catch (e) {
        console.error("Failed to parse stored auth", e);
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return null;
    }
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 6000): Promise<T | null> {
    let timeoutId: number | undefined;

    try {
        const response = await Promise.race([
            apiFetch(url),
            new Promise<never>((_, reject) => {
                timeoutId = window.setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
            })
        ]);

        if (!response.ok) return null;
        return await response.json() as T;
    } catch (e) {
        console.warn(`Request failed or timed out: ${url}`, e);
        return null;
    } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
    }
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<UserInfo | null>(null);
    const [server, setServer] = useState<ServerInfo | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();
    const t = useT();

    useEffect(() => {
        const initAuth = async () => {
            try {
                const storedAuth = readStoredAuth();
                if (storedAuth) {
                    setUser(storedAuth.user);
                    setServer(storedAuth.server);
                    setIsAuthenticated(true);
                    setIsLoading(false);
                }

                const data = await fetchJsonWithTimeout<ConfigResponse>('/api/config');
                if (data?.authenticated && data.user && data.server) {
                    setUser(data.user);
                    setServer(data.server);
                    setIsAuthenticated(true);
                    storeAuth({ user: data.user, server: data.server });
                } else if (data) {
                    // The server answered: this browser has no session (expired, signed
                    // out elsewhere, or a visitor). The cached account is stale.
                    storeAuth(null);
                    setUser(null);
                    setServer(null);
                    setIsAuthenticated(false);
                } else if (!storedAuth) {
                    setIsAuthenticated(false);
                }
                // No answer at all (offline, timeout): keep the cached account.
            } catch (e) {
                console.error("Critical error in initAuth:", e);
            } finally {
                setIsLoading(false);
            }
        };

        initAuth();
    }, []);

    const login = async (hostUrl: string, username: string, password: string, redirectTo?: string) => {
        setIsLoading(true);
        try {
            const res = await apiFetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ hostUrl, username, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(res.status === 403 ? t('login.accountTaken') : (data.error || t('login.failedShort')));
            }

            const userInfo = data.user_info as UserInfo;
            const serverInfo = data.server_info as ServerInfo;

            storeAuth({ user: userInfo, server: serverInfo });

            setUser(userInfo);
            setServer(serverInfo);
            setIsAuthenticated(true);

            router.push(typeof redirectTo === 'string' ? redirectTo : '/garratv/home');

        } catch (error) {
            console.error(error);
            throw error;
        } finally {
            setIsLoading(false);
        }
    };

    const logout = async (redirectTo?: string) => {
        try {
            // Cache first: signing out ends the session the cache write needs.
            await db.clearCache();
        } catch (e) {
            console.error("Failed to clear the catalog cache", e);
        }
        try {
            await apiFetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
        } catch (e) {
            console.error("Failed to clear server config", e);
        }
        storeAuth(null);
        setUser(null);
        setServer(null);
        setIsAuthenticated(false);
        // onClick={logout} passes the click event; only an explicit path may override the default.
        router.push(typeof redirectTo === 'string' ? redirectTo : '/garratv');
    };

    return (
        <AuthContext.Provider value={{ user, server, isAuthenticated, login, logout, isLoading }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
