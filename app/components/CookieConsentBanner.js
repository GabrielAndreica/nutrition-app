'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import styles from './CookieConsentBanner.module.css';

const STORAGE_KEY = 'trevano_cookie_consent';
const PROTECTED_ROUTE_PREFIXES = [
  '/dashboard',
  '/clients',
  '/client',
  '/generator-plan',
  '/generator-antrenament',
  '/meal-plan',
  '/workout-plan',
];

function isProtectedRoute(pathname) {
  return PROTECTED_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export default function CookieConsentBanner() {
  const pathname = usePathname();
  const [hasChoice, setHasChoice] = useState(null);

  const shouldShowOnRoute = useMemo(() => {
    if (!pathname) return false;
    return !isProtectedRoute(pathname);
  }, [pathname]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      try {
        setHasChoice(Boolean(window.localStorage.getItem(STORAGE_KEY)));
      } catch {
        setHasChoice(false);
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const savePreference = (value) => {
    const payload = {
      value,
      savedAt: new Date().toISOString(),
      version: 1,
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent('trevano-cookie-consent', { detail: payload }));
    } catch {
      // If storage is unavailable, still hide the banner for this session.
    }

    setHasChoice(true);
  };

  if (hasChoice === null || hasChoice || !shouldShowOnRoute) return null;

  return (
    <section className={styles.banner} aria-label="Preferințe cookie Trevano">
      <div className={styles.content}>
        <p className={styles.title}>Cookie-uri necesare</p>
        <p className={styles.text}>
          Folosim cookie-uri pentru autentificare și funcționarea aplicației. Nu folosim tracking sau marketing.
        </p>
        <Link href="/politica-cookies" className={styles.policyLink}>
          Politica Cookies
        </Link>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.rejectButton}
          onClick={() => savePreference('rejected')}
        >
          Respinge
        </button>
        <button
          type="button"
          className={styles.acceptButton}
          onClick={() => savePreference('accepted')}
        >
          Acceptă
        </button>
      </div>
    </section>
  );
}
