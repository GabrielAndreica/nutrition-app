'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './AppHeader.module.css';

/**
 * Shared sticky header — folosit pe toate paginile autentificate.
 *
 * Props:
 *   title      — breadcrumb afișat după logo  (ex. "Clienți")
 *   backHref   — dacă e definit, apare butonul chevron ‹ pe stânga
 *   backLabel  — aria-label pentru butonul back (default "Înapoi")
 */
export default function AppHeader({ title, backHref, backLabel = 'Înapoi' }) {
  const router = useRouter();
  const { user, logout } = useAuth();

  return (
    <header className={styles.header}>
      <div className={styles.inner}>

        {/* ── Left ─────────────────────────────── */}
        <div className={styles.left}>
          {backHref && (
            <button
              className={styles.backBtn}
              onClick={() => router.push(backHref)}
              aria-label={backLabel}
            >
              <svg
                width="15" height="15" viewBox="0 0 24 24"
                fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}

          <button
            className={styles.logo}
            onClick={() => router.push('/dashboard')}
            aria-label="Acasă"
          >
            <span className={styles.logoMark}>N</span>
            <span className={styles.logoText}>NutritionApp</span>
          </button>

          {title && (
            <>
              <span className={styles.sep} aria-hidden="true">/</span>
              <span className={styles.pageTitle}>{title}</span>
            </>
          )}
        </div>

        {/* ── Right ────────────────────────────── */}
        <div className={styles.right}>
          {user?.name && (
            <span className={styles.userName}>{user.name}</span>
          )}
          <button
            className={styles.logoutBtn}
            onClick={() => { logout(); router.push('/'); }}
          >
            Ieșire
          </button>
        </div>

      </div>
    </header>
  );
}
