'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { markExternalNavigation } from '@/app/components/ExternalNavigationReloadGuard';
import { trackMarketingEvent } from '@/app/lib/marketingEvents';
import styles from './upgrade.module.css';

const PLAN_PRICES_RON = {
  starter: 149,
  pro: 249,
};

function UpgradeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token } = useAuth();
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

  const handleHeaderAction = async () => {
    router.push('/client/dashboard');
  };

  function getBannerText() {
    if (reason === 'paid_required') return 'Această funcție este disponibilă pe planul plătit.';
    if (payment === 'cancelled') return 'Plata a fost anulată. Poți alege oricând un plan.';
    return 'Alege planul care ți se potrivește.';
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

      trackMarketingEvent('InitiateCheckout', {
        content_name: `Trevano ${planType}`,
        content_type: 'subscription',
        currency: 'RON',
        value: PLAN_PRICES_RON[planType],
      });
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
        <button className={styles.backBtn} onClick={handleHeaderAction}>
          Înapoi la dashboard
        </button>
        <div className={styles.logo}>trevano</div>
      </header>

      {/* Status banner */}
      <div className={reason === 'paid_required' ? styles.bannerExpired : styles.bannerInfo}>
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
        <p className={styles.subtitle}>Deblochează mai multă varietate, progres și flexibilitate în planul tău.</p>
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
            <li className={styles.feature}><span className={styles.check}>✓</span> Mai multe rețete deblocabile</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Plan alimentar cu varietate extinsă</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Antrenamente personalizate</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Monitorizare progres și XP</li>
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
            <li className={styles.feature}><span className={styles.check}>✓</span> Experiență completă pentru progres</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Tot ce include Starter</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Statistici avansate</li>
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
