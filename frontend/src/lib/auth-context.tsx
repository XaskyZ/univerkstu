'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
    login as apiLogin,
    register as apiRegister,
    curatorLogin as apiCuratorLogin,
    logout as apiLogout,
    verifyToken,
    isAuthenticated,
    getUserId,
} from '@/lib/api';
import { hydrateStartupBootstrap } from '@/lib/startup-bootstrap';
import { useLanguage } from '@/lib/language-context';
import { notifySessionExpired } from '@/lib/session-expired';

const IS_DEV = process.env.NODE_ENV !== 'production';

export interface AuthActionResult {
    success: boolean;
    error?: string;
    /** Backend error code (e.g. `AUTH_NOT_REGISTERED`, `AUTH_ALREADY_REGISTERED`) so screens can branch on it. */
    errorCode?: string;
    referralStatus?: string;
}

interface AuthContextType {
    isAuth: boolean;
    userId: string | null;
    loading: boolean;
    login: (username: string, password: string, referralCode?: string) => Promise<AuthActionResult>;
    /** Create the app account for an existing Platonus login (first sign in). */
    register: (login: string, password: string, referralCode?: string) => Promise<AuthActionResult>;
    loginCurator: (userId: string, password: string) => Promise<{ success: boolean; error?: string }>;
    /**
     * Finish a login that was completed outside the password form (QR / push
     * challenge): the token is already stored by the API layer, this only
     * updates context state and runs the same startup bootstrap as `login`.
     */
    completeExternalLogin: (userId: string) => Promise<void>;
    /**
     * Sign the user out. Pass `'expired'` for forced logouts after a 401 so the
     * user sees a "session expired" toast; the default `'manual'` is silent.
     */
    logout: (reason?: 'manual' | 'expired') => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface VerifyResponse {
    success: boolean;
    statusCode?: number;
    user?: {
        userId: string;
    };
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const { language } = useLanguage();
    const [isAuth, setIsAuth] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const checkAuth = async () => {
            const hasLocalToken = isAuthenticated();
            const cachedUserId = getUserId();

            if (!hasLocalToken && !cachedUserId) {
                setIsAuth(false);
                setUserId(null);
                setLoading(false);
                return;
            }

            setIsAuth(true);
            setUserId(cachedUserId);

            const result = await verifyToken() as VerifyResponse;

            if (result.success && result.user) {
                setIsAuth(true);
                setUserId(result.user.userId);
                localStorage.setItem('userId', result.user.userId);
                const bootstrap = await hydrateStartupBootstrap(result.user.userId).catch((error) => {
                    if (IS_DEV) {
                        console.warn('[Auth] Startup bootstrap failed during verify', error);
                    }
                    return { success: false as const };
                });
                if (!bootstrap.success && IS_DEV) {
                    console.warn('[Auth] Verify succeeded, but startup bootstrap was not hydrated.');
                }
                if (IS_DEV) {
                    console.log('Session verified (background)');
                }
            } else if (result.statusCode === 0 && (hasLocalToken || Boolean(cachedUserId))) {
                // Сетевая ошибка — работаем оффлайн с кешем
                if (IS_DEV) {
                    console.warn('[Auth] Network error during verify. Staying in offline mode.');
                }
            } else {
                // 401 even after auto-renewal means token is invalid or user no longer exists.
                if (IS_DEV) {
                    console.warn(`[Auth] Verify failed (${result.statusCode}). Token invalid, logging out.`);
                }
                await apiLogout();
                setIsAuth(false);
                setUserId(null);
            }

            setLoading(false);
        };

        checkAuth().catch((error) => {
            console.error('[Auth] Failed to bootstrap auth context', error);
            setIsAuth(false);
            setUserId(null);
            setLoading(false);
        });
    }, []);

    const finishSignIn = async (nextUserId: string, source: string) => {
        setIsAuth(true);
        setUserId(nextUserId);
        const bootstrap = await hydrateStartupBootstrap(nextUserId, { force: true }).catch((error) => {
            if (IS_DEV) {
                console.warn(`[Auth] Startup bootstrap failed after ${source}`, error);
            }
            return { success: false as const };
        });
        if (!bootstrap.success && IS_DEV) {
            console.warn(`[Auth] ${source} succeeded, but startup bootstrap was not hydrated.`);
        }
    };

    const login = async (username: string, password: string, referralCode?: string): Promise<AuthActionResult> => {
        setLoading(true);
        const result = await apiLogin(username, password, referralCode);

        if (result.success && result.user) {
            await finishSignIn(result.user.userId, 'login');
            setLoading(false);
            return { success: true, referralStatus: result.referral?.status };
        }

        setLoading(false);
        return { success: false, error: result.error, errorCode: result.errorCode, referralStatus: result.referral?.status };
    };

    const register = async (login: string, password: string, referralCode?: string): Promise<AuthActionResult> => {
        setLoading(true);
        const result = await apiRegister(login, password, referralCode);

        if (result.success && result.user) {
            await finishSignIn(result.user.userId, 'register');
            setLoading(false);
            return { success: true, referralStatus: result.referral?.status };
        }

        setLoading(false);
        return { success: false, error: result.error, errorCode: result.errorCode, referralStatus: result.referral?.status };
    };

    const completeExternalLogin = async (nextUserId: string) => {
        setLoading(true);
        await finishSignIn(nextUserId, 'challenge login');
        setLoading(false);
    };

    const loginCurator = async (userId: string, password: string) => {
        setLoading(true);
        const result = await apiCuratorLogin(userId, password);

        if (result.success && result.user) {
            setIsAuth(true);
            setUserId(result.user.userId);
            setLoading(false);
            return { success: true };
        }

        setLoading(false);
        return { success: false, error: result.error };
    };

    const logout = async (reason: 'manual' | 'expired' = 'manual') => {
        if (reason === 'expired') {
            notifySessionExpired(language);
        }
        await apiLogout();
        setIsAuth(false);
        setUserId(null);
        setLoading(false);
    };

    return (
        <AuthContext.Provider value={{ isAuth, userId, loading, login, register, loginCurator, completeExternalLogin, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
