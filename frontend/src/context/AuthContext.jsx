import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import client from '../api/client';

/**
 * AuthContext — provides: user, token, login(), logout(), loading
 *
 * token: stored in sessionStorage (cleared on tab close).
 * For persistent login switch to localStorage.
 */

const AuthContext = createContext(null);
const TOKEN_KEY = 'direttore_access';
const REFRESH_KEY = 'direttore_refresh';

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);   // { username, role, permissions }
    const [loading, setLoading] = useState(true);   // true while checking stored token

    // ── Restore session from storage on first load ────────────────────────────
    useEffect(() => {
        const token = sessionStorage.getItem(TOKEN_KEY);
        if (!token) { setLoading(false); return; }

        // Validate the stored token by calling /me
        client.get('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => {
                client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
                setUser(r.data);
            })
            .catch(() => {
                sessionStorage.removeItem(TOKEN_KEY);
                sessionStorage.removeItem(REFRESH_KEY);
            })
            .finally(() => setLoading(false));
    }, []);

    // ── Login ─────────────────────────────────────────────────────────────────
    const login = useCallback(async (username, password) => {
        const form = new URLSearchParams();
        form.append('username', username);
        form.append('password', password);
        form.append('grant_type', 'password');

        const { data } = await client.post('/api/auth/token', form, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        sessionStorage.setItem(TOKEN_KEY, data.access_token);
        sessionStorage.setItem(REFRESH_KEY, data.refresh_token);
        client.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`;

        // Fetch the full profile
        const me = await client.get('/api/auth/me');
        setUser(me.data);
    }, []);

    // ── Logout ────────────────────────────────────────────────────────────────
    const logout = useCallback(() => {
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(REFRESH_KEY);
        delete client.defaults.headers.common['Authorization'];
        setUser(null);
    }, []);

    // ── Auto-refresh on 401 ───────────────────────────────────────────────────
    useEffect(() => {
        const id = client.interceptors.response.use(
            r => r,
            async err => {
                const orig = err.config;
                if (err.response?.status === 401 && !orig._retry) {
                    orig._retry = true;
                    const refresh = sessionStorage.getItem(REFRESH_KEY);
                    if (refresh) {
                        try {
                            const { data } = await client.post('/api/auth/refresh', { refresh_token: refresh });
                            sessionStorage.setItem(TOKEN_KEY, data.access_token);
                            sessionStorage.setItem(REFRESH_KEY, data.refresh_token);
                            client.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`;
                            orig.headers['Authorization'] = `Bearer ${data.access_token}`;
                            return client(orig);
                        } catch {
                            logout();
                        }
                    } else {
                        logout();
                    }
                }
                return Promise.reject(err);
            }
        );
        return () => client.interceptors.response.eject(id);
    }, [logout]);

    return (
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}
