'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import AppHeader from '@/app/components/AppHeader';
import styles from './dashboard.module.css';

function ClientDashboardContent() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingSpinner}></div>
      </div>
    );
  }

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
            Vizualizează planurile tale alimentare și progresul.
          </p>
        </div>

        <div className={styles.card} onClick={() => router.push('/client/plans')}>
          <div className={styles.cardBody}>
            <div className={styles.cardIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </div>
            <div>
              <h2 className={styles.cardTitle}>Planurile mele</h2>
              <p className={styles.cardDesc}>Planuri alimentare personalizate și progres</p>
            </div>
          </div>
          <div className={styles.cardActions}>
            <button
              className={styles.cardBtn}
              onClick={e => { e.stopPropagation(); router.push('/client/plans'); }}
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

export default function ClientDashboard() {
  return (
    <ProtectedRoute requiredRole="client">
      <ClientDashboardContent />
    </ProtectedRoute>
  );
}
