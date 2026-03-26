'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import AppHeader from '@/app/components/AppHeader';
import styles from './dashboard.module.css';

function DashboardContent() {
  const router = useRouter();
  const { user } = useAuth();

  // Prefetch page bundle + warm up API cache so /clients feels instant
  useEffect(() => {
    router.prefetch('/clients');

    // Fire the clients API request now so the browser HTTP cache is already populated
    // by the time the user navigates. Fire-and-forget — errors are intentionally ignored.
    const token = localStorage.getItem('token');
    if (token) {
      fetch('/api/clients?page=1&limit=20', {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }, [router]);

  const firstName = user?.name?.split(' ')[0] || user?.name || '';

  return (
    <div className={styles.container}>
      <AppHeader />

      <div className={styles.content}>
        <div className={styles.hero}>
          <h2 className={styles.heroHeading}>
            Bună ziua, <span className={styles.accent}>{firstName}</span>.
          </h2>
          <p className={styles.heroSub}>
            Generează și gestionează planuri alimentare personalizate.
          </p>
        </div>

        <div className={styles.card} onClick={() => router.push('/clients')}>
          <div className={styles.cardBody}>
            <div className={styles.cardIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div>
              <h2 className={styles.cardTitle}>Clienți</h2>
              <p className={styles.cardDesc}>Profiluri, planuri alimentare și export PDF</p>
            </div>
          </div>
          <div className={styles.cardActions}>
            <button
              className={styles.cardBtn}
              onClick={e => { e.stopPropagation(); router.push('/clients'); }}
            >
              Deschide
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} NutritionApp</span>
        <span className={styles.footerDot} />
        <span>v1.0</span>
      </footer>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
