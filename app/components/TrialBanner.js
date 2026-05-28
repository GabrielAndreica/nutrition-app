'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './TrialBanner.module.css';

export default function TrialBanner() {
  const { user } = useAuth();
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const status = data?.subscription_status ?? user.subscription_status;

        if (status !== 'trial') {
          setVisible(false);
          return;
        }

        fetch('/api/stripe/sync-subscription', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
          .then(r => r.ok ? r.json() : null)
          .then(syncData => {
            if (syncData?.subscription_status && syncData.subscription_status !== 'trial') {
              setVisible(false);
            }
          })
          .catch(() => {});

        setVisible(true);
      })
      .catch(() => {
        if (user.subscription_status !== 'trial') return;
        setVisible(true);
      });
  }, [user]);

  if (!visible) return null;
  return (
    <div className={`${styles.banner} ${styles.normal}`} role="alert">
      <span className={styles.message}>
        Plan gratuit — maxim <span className={styles.daysLeft}>3 clienți</span> activi.
      </span>
      <div className={styles.actions}>
        <button className={styles.upgradeBtn} onClick={() => router.push('/upgrade')}>
          Upgrade
        </button>
      </div>
    </div>
  );
}