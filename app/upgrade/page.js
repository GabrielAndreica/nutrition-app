'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { markExternalNavigation } from '@/app/components/ExternalNavigationReloadGuard';
import { trackMarketingEvent } from '@/app/lib/marketingEvents';
import styles from './upgrade.module.css';

const COACH_PLAN_TYPE = 'coach';
const COACH_PRICE_RON = 29.99;

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
    return '';
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
        content_name: 'Trevano Coach',
        content_type: 'subscription',
        currency: 'RON',
        value: COACH_PRICE_RON,
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
      {getBannerText() && (
        <div className={reason === 'paid_required' ? styles.bannerExpired : styles.bannerInfo}>
          {getBannerText()}
        </div>
      )}

      {checkoutError && (
        <div className={styles.bannerExpired}>
          {checkoutError}
        </div>
      )}

      <div className={styles.titleSection}>
        <h1 className={styles.title}>Trevano Coach</h1>
        <p className={styles.subtitle}>
          Feedback săptămânal, ajustări automate și recomandări clare pentru planul tău.
        </p>
      </div>

      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.planName}>Abonament lunar</h2>
              <p className={styles.planSubtitle}>Pentru progres ghidat, nu doar urmărit.</p>
            </div>
            <div className={styles.price}>
              <span className={styles.amount}>29,99</span>
              <span className={styles.currency}>lei</span>
              <span className={styles.period}>/lună</span>
            </div>
          </div>

          <ul className={styles.features}>
            <li className={styles.feature}><span className={styles.check}>✓</span> Raport premium după check-in</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Ajustări automate la calorii și macro</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Recomandări pentru antrenamente</li>
            <li className={styles.feature}><span className={styles.check}>✓</span> Feedback pentru mese, apă, foame și aderență</li>
          </ul>

          <button className={styles.btnAccent} onClick={() => handlePlanClick(COACH_PLAN_TYPE)} disabled={loadingPlan !== null}>
            {loadingPlan === COACH_PLAN_TYPE ? 'Se deschide plata...' : 'Activează Trevano Coach'}
          </button>

          <p className={styles.finePrint}>Poți gestiona sau anula abonamentul din contul tău Stripe.</p>
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
