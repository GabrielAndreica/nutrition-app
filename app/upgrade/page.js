'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { markExternalNavigation } from '@/app/components/ExternalNavigationReloadGuard';
import styles from './upgrade.module.css';

function UpgradeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { logout, token } = useAuth();
  const reason = searchParams.get('reason');
  const payment = searchParams.get('payment');
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [checkoutError, setCheckoutError] = useState('');

  useEffect(() => {
    const resetCheckoutState = () => {
      setLoadingPlan(null);
    };

    window.addEventListener('pageshow', resetCheckoutState);
    window.addEventListener('focus', resetCheckoutState);

    return () => {
      window.removeEventListener('pageshow', resetCheckoutState);
      window.removeEventListener('focus', resetCheckoutState);
    };
  }, [payment]);

  const handleLogout = async () => {
    await logout();
    router.replace('/auth');
  };

  function getBannerText() {
    if (reason === 'trial_expired') return 'Perioada de trial a expirat. Alege un plan pentru a continua.';
    if (reason === 'subscription_inactive') return 'Abonamentul tău este inactiv. Reactivează-l pentru a continua.';
    if (payment === 'cancelled') return 'Plata a fost anulată. Poți alege oricând un plan.';
    return 'Alege planul potrivit pentru tine.';
  }

  async function handlePlanClick(planType) {
    setCheckoutError('');
    setLoadingPlan(planType);

    try {
      const authToken = token || localStorage.getItem('token');
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ planType }),
      });

      const data = await res.json();
      if (!res.ok) {
        setCheckoutError(data.error || 'Nu am putut porni plata. Încearcă din nou.');
        return;
      }

      markExternalNavigation();
      window.location.assign(data.url);
    } catch {
      setCheckoutError('Eroare de rețea. Încearcă din nou.');
    } finally {
      setLoadingPlan(null);
    }
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

      {checkoutError && (
        <div className={styles.bannerExpired}>
          {checkoutError}
        </div>
      )}

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
          <button className={styles.btnPrimary} onClick={() => handlePlanClick('starter')} disabled={loadingPlan !== null}>
            {loadingPlan === 'starter' ? 'Se deschide plata...' : 'Alege Starter'}
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
          <button className={styles.btnAccent} onClick={() => handlePlanClick('pro')} disabled={loadingPlan !== null}>
            {loadingPlan === 'pro' ? 'Se deschide plata...' : 'Alege Pro'}
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
