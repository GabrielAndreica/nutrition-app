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
  const { logout, token, user } = useAuth();
  const reason = searchParams.get('reason');
  const payment = searchParams.get('payment');
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [checkoutError, setCheckoutError] = useState('');
  const trialExpired = false; // Trial este acum plan gratuit permanent
  const subscriptionInactive = ['expired', 'cancelled', 'inactive'].includes(user?.subscription_status);
  const mustChoosePlan = reason === 'subscription_inactive' || subscriptionInactive;

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
    if (!mustChoosePlan) {
      router.push('/dashboard');
      return;
    }

    await logout();
    router.replace('/auth');
  };

  function getBannerText() {
    if (reason === 'subscription_inactive') return 'Abonamentul tău este inactiv. Reactivează-l pentru a continua.';
    if (reason === 'client_limit') return 'Ai atins limita de 3 clienți din planul gratuit. Upgrade pentru mai mult.';
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
          {mustChoosePlan ? 'Ieșire' : 'Înapoi la dashboard'}
        </button>
        <div className={styles.logo}>trevano</div>
      </header>

      {/* Status banner */}
      <div className={reason === 'subscription_inactive' ? styles.bannerExpired : styles.bannerInfo}>
        {getBannerText()}
      </div>

      {checkoutError && (
        <div className={styles.bannerExpired}>
          {checkoutError}
        </div>
      )}

      {/* Page title */}
      <div className={styles.titleSection}>
        <h1 className={styles.title}>Crește odată cu clienții tăi</h1>
        <p className={styles.subtitle}>Planul gratuit include până la 3 clienți. Fără limită de timp.</p>
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
            <li className={styles.feature}><span className={styles.check}>✓</span> Tot ce include Free</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Portal clienți</li>
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
