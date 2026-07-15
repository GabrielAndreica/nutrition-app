'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const AuthContext = createContext();

// Rute publice, fără sesiune obligatorie.
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

        const parsedUser = JSON.parse(userData);

        // ── Verificare onboarding status pentru B2C users ────────────────
        if (!isPublicPath(pathname) && (parsedUser?.role === 'user' || parsedUser?.role === 'client')) {
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
