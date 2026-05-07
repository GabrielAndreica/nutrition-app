'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './upgrade.module.css';

function UpgradeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, logout } = useAuth();
  const reason = searchParams.get('reason');

  const handleLogout = async () => {
    await logout();
    router.replace('/auth');
  };

  function getBannerText() {
    if (reason === 'trial_expired') return 'Perioada de trial a expirat. Alege un plan pentru a continua.';
    if (reason === 'subscription_inactive') return 'Abonamentul tău este inactiv. Reactivează-l pentru a continua.';
    return 'Alege planul potrivit pentru tine.';
  }

  function handlePlanClick(plan) {
    // TODO: Integrate Stripe payment
    console.log(`[Upgrade] Plan selectat: ${plan}`);
    alert(`Integrare Stripe în curând! Plan ales: ${plan}`);
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={handleLogout}>
          Ieșire
        </button>
        <div className={styles.logo}>trevano</div>
      </header>

      {/* Status banner */}
      <div className={reason === 'trial_expired' || reason === 'subscription_inactive' ? styles.bannerExpired : styles.bannerInfo}>
        {getBannerText()}
      </div>

      {/* Page title */}
      <div className={styles.titleSection}>
        <h1 className={styles.title}>Alege planul tău</h1>
        <p className={styles.subtitle}>Fără contracte. Anulezi oricând.</p>
      </div>

      {/* Pricing cards */}
      <div className={styles.cards}>

        {/* Starter */}
        <div className={styles.card}>
          <div className={styles.cardBadge}>Popular</div>
          <h2 className={styles.planName}>Starter</h2>
          <div className={styles.price}>
            <span className={styles.amount}>149</span>
            <span className={styles.currency}>RON</span>
            <span className={styles.period}>/lună</span>
          </div>
          <ul className={styles.features}>
            <li className={styles.feature}><span className={styles.check}>✓</span> Până la <strong>10 clienți</strong></li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Generare planuri nutriționale</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Generare planuri de antrenament</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Monitorizare progres</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Suport email</li>
          </ul>
          <button className={styles.btnPrimary} onClick={() => handlePlanClick('Starter 149 RON/lună')}>
            Alege Starter
          </button>
        </div>

        {/* Pro */}
        <div className={`${styles.card} ${styles.cardPro}`}>
          <div className={styles.cardBadgePro}>Recomandat</div>
          <h2 className={styles.planName}>Pro</h2>
          <div className={styles.price}>
            <span className={styles.amount}>249</span>
            <span className={styles.currency}>RON</span>
            <span className={styles.period}>/lună</span>
          </div>
          <ul className={styles.features}>
            <li className={styles.feature}><span className={styles.check}>✓</span> Până la <strong>30 de clienți</strong></li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Tot ce include Starter</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Statistici avansate</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Branding personalizat</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Suport prioritar</li>
          </ul>
          <button className={styles.btnAccent} onClick={() => handlePlanClick('Pro 249 RON/lună')}>
            Alege Pro
          </button>
        </div>

      </div>


    </div>
  );
}

export default function UpgradePage() {
  return (
    <Suspense>
      <UpgradeContent />
    </Suspense>
  );
}
