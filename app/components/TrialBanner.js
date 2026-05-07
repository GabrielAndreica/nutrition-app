'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './TrialBanner.module.css';

export default function TrialBanner() {
  const { user } = useAuth();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [daysLeft, setDaysLeft] = useState(null);

  useEffect(() => {
    if (!user) return;

    // Citește live din DB — JWT-ul poate fi vechi dacă data a fost modificată
    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const status = data?.subscription_status ?? user.subscription_status;
        const trialEndsAt = data?.trial_ends_at ?? user.trial_ends_at;

        if (status !== 'trial') return;

        if (trialEndsAt) {
          const diff = new Date(trialEndsAt) - new Date();
          const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
          setDaysLeft(Math.max(0, days));
        } else {
          setDaysLeft(14);
        }

        setVisible(true);
      })
      .catch(() => {
        // Fallback la JWT dacă fetch eșuează
        if (user.subscription_status !== 'trial') return;
        if (user.trial_ends_at) {
          const diff = new Date(user.trial_ends_at) - new Date();
          setDaysLeft(Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24))));
        } else {
          setDaysLeft(14);
        }
        setVisible(true);
      });
  }, [user]);

  if (!visible) return null;

  const isUrgent  = daysLeft !== null && daysLeft <= 3;
  const isWarning = daysLeft !== null && daysLeft <= 7 && !isUrgent;
  const variantClass = isUrgent ? styles.urgent : isWarning ? styles.warning : styles.normal;

  function getDaysText() {
    if (daysLeft === 0) return <span className={styles.daysLeft}>expiră astăzi</span>;
    if (daysLeft === 1) return <><span className={styles.daysLeft}>1 zi</span> rămasă din trial</>;
    return <><span className={styles.daysLeft}>{daysLeft} zile</span> rămase din trial</>;
  }

  return (
    <div className={`${styles.banner} ${variantClass}`} role="alert">
      <span className={styles.message}>
        {getDaysText()} — maxim 3 clienți în perioadă de trial.
      </span>
      <div className={styles.actions}>
        <button className={styles.upgradeBtn} onClick={() => router.push('/upgrade')}>
          Vezi planuri
        </button>
      </div>
    </div>
  );
}
