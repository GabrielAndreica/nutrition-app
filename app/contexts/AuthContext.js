'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const AuthContext = createContext();

// Rute unde NU facem subscription check (pagini publice + upgrade însuși)
const PUBLIC_PATHS = ['/', '/auth', '/register', '/confirm', '/upgrade', '/landing'];

function isPublicPath(pathname) {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [token, setToken]     = useState(null);
  const [loading, setLoading] = useState(true);
  const router   = useRouter();
  const pathname = usePathname();
  // Abort controller pentru fetch /api/auth/me — evităm memory leak la unmount
  const abortRef = useRef(null);

  const clearStoredAuth = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    document.cookie = 'token=; path=/; max-age=0';
    setUser(null);
    setToken(null);
  };

  useEffect(() => {
    const syncAuthFromStorage = () => {
      const userData  = localStorage.getItem('user');
      const tokenData = localStorage.getItem('token');

      if (!userData || !tokenData) {
        clearStoredAuth();
        setLoading(false);
        if (!isPublicPath(pathname)) {
          router.replace('/auth');
        }
        return;
      }
      try {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
        setToken(tokenData);
        document.cookie = `token=${tokenData}; path=/; SameSite=Lax`;
        setLoading(false);
      } catch (err) {
        console.error('[AuthContext] Failed to parse stored user:', err);
        clearStoredAuth();
        setLoading(false);
      }
    };

    const userData  = localStorage.getItem('user');
    const tokenData = localStorage.getItem('token');
    let isValidatingSession = false;

    if (!userData || !tokenData) {
      clearStoredAuth();
    } else {
      try {
        setUser(JSON.parse(userData));

        setToken(tokenData);
        // Sincronizează cookie-ul pentru middleware (Edge Runtime)
        document.cookie = `token=${tokenData}; path=/; SameSite=Lax`;

        // ── Verificare live subscription (JWT poate fi stale) ────────────
        // Sărind paginile publice și /upgrade — ele nu necesită subscripție
        // Utilizatorii cu rol 'user' nu au subscripție — sărind verificarea
        const parsedUser = JSON.parse(userData);

        // ── Verificare onboarding status pentru role 'user' ──────────────
        if (!isPublicPath(pathname) && parsedUser?.role === 'user') {
          // Dacă localStorage nu are onboarding_completed, setează-l false pending verificare
          // astfel ProtectedRoute știe să aștepte (nu va fi undefined)
          if (parsedUser.onboarding_completed === undefined) {
            const pending = { ...parsedUser, onboarding_completed: false };
            setUser(pending);
            localStorage.setItem('user', JSON.stringify(pending));
          }
          isValidatingSession = true;
          fetch('/api/user/onboarding', {
            headers: { Authorization: `Bearer ${tokenData}` },
            cache: 'no-store',
          })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (!data) return;
              const completed = data.onboarding_completed === true;
              setUser(currentUser => {
                if (!currentUser) return currentUser;
                const updatedUser = { ...currentUser, onboarding_completed: completed };
                localStorage.setItem('user', JSON.stringify(updatedUser));
                return updatedUser;
              });
            })
            .catch(() => {})
            .finally(() => setLoading(false));
        }

        if (!isPublicPath(pathname) && parsedUser?.role !== 'user') {
          isValidatingSession = true;
          abortRef.current?.abort(); // anulează orice fetch anterior
          const controller = new AbortController();
          abortRef.current = controller;

          fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${tokenData}` },
            cache: 'no-store',
            signal: controller.signal,
          })
              .then(r => {
                if (r.status === 401 || r.status === 403) {
                  clearStoredAuth();
                  router.replace('/auth?reason=session_expired');
                  return null;
                }

                return r.ok ? r.json() : null;
              })
              .then(data => {
                if (!data) return;
                const { subscription_status, subscription_plan, trial_ends_at } = data;

                setUser(currentUser => {
                  if (!currentUser) return currentUser;

                  const updatedUser = {
                    ...currentUser,
                    subscription_status,
                    subscription_plan,
                    trial_ends_at,
                  };

                  localStorage.setItem('user', JSON.stringify(updatedUser));
                  return updatedUser;
                });

                if (subscription_status === 'trial') {
                  if (trial_ends_at && new Date(trial_ends_at) < new Date()) {
                    router.replace('/upgrade?reason=trial_expired');
                  }
                } else if (subscription_status === 'cancelled' || subscription_status === 'inactive' || subscription_status === 'expired') {
                  router.replace('/upgrade?reason=subscription_inactive');
                }
              })
              .catch(err => {
                if (err.name !== 'AbortError') {
                  console.warn('[AuthContext] /api/auth/me failed, using JWT fallback');
                }
              })
              .finally(() => {
                setLoading(false);
              });
        }
      } catch (err) {
        console.error('[AuthContext] Failed to parse stored user:', err);
        clearStoredAuth();
      }
    }

    if (!isValidatingSession) {
      setLoading(false);
    }
    window.addEventListener('pageshow', syncAuthFromStorage);
    window.addEventListener('focus', syncAuthFromStorage);

    return () => {
      abortRef.current?.abort();
      window.removeEventListener('pageshow', syncAuthFromStorage);
      window.removeEventListener('focus', syncAuthFromStorage);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    // Notifică serverul pentru a înregistra deconectarea în activity_logs
    const currentToken = token || localStorage.getItem('token');
    if (currentToken) {
      try {
        await fetch('/api/auth/signout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${currentToken}` },
        });
      } catch {
        // fire-and-forget — ignoră erorile de rețea
      }
    }

    setUser(null);
    setToken(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    // Șterge cookie-ul token
    document.cookie = 'token=; path=/; max-age=0';
  };

  const login = (userData, tokenData) => {
    setUser(userData);
    setToken(tokenData);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', tokenData);
    document.cookie = `token=${tokenData}; path=/; SameSite=Lax`;
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout, login, token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
