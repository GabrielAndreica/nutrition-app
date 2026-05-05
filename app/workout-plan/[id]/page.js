'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import AppHeader from '@/app/components/AppHeader';
import styles from './workout-plan-view.module.css';
import shellStyles from '@/app/meal-plan/meal-plan-view.module.css';

const WorkoutPlan = dynamic(() => import('@/app/components/WorkoutPlanGenerator/WorkoutPlan'), {
  ssr: false,
  loading: () => <SkeletonWorkoutPlan />,
});

function SkeletonWorkoutPlan() {
  return (
    <div className={styles.skeletonWrap}>
      <div className={styles.skeletonClientHeader}>
        <div className={styles.skeletonNameBlock}>
          <div className={`${styles.shimmer} ${styles.skeletonName}`} />
          <div className={`${styles.shimmer} ${styles.skeletonSub}`} />
        </div>
        <div className={styles.skeletonStats}>
          {[1, 2, 3].map(i => (
            <div key={i} className={`${styles.shimmer} ${styles.skeletonStat}`} />
          ))}
        </div>
      </div>
      <div className={styles.skeletonTabsRow}>
        {[1, 2, 3, 4, 5, 6, 7].map(i => (
          <div key={i} className={`${styles.shimmer} ${styles.skeletonTab}`} />
        ))}
      </div>
      <div className={`${styles.shimmer} ${styles.skeletonCard}`} />
    </div>
  );
}

function WorkoutPlanViewContent() {
  const router = useRouter();
  const { id } = useParams();

  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [mealPlanId, setMealPlanId] = useState(null);
  const [planTab, setPlanTab] = useState('antrenament');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    const token = localStorage.getItem('token');
    if (!token) { router.push('/auth'); return; }

    fetch(`/api/workout-plans/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(async data => {
        if (data.error) throw new Error(data.error);
        setWorkoutPlan(data.workoutPlan?.plan_data || data.workoutPlan);
        setClientData(data.client);

        const clientId = data.workoutPlan?.client_id;
        if (!clientId) return;
        const mealRes = await fetch(`/api/meal-plans?clientId=${encodeURIComponent(clientId)}`, {
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!mealRes.ok) return;
        const mealData = await mealRes.json();
        const foundMealPlanId = mealData.plans?.[clientId]?.planId || null;
        setMealPlanId(foundMealPlanId);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, router]);

  const handleReset = () => router.push('/clients');

  if (loading) {
    return (
      <div className={styles.page}>
        <AppHeader title="Plan Antrenament" backHref="/clients" />
        <div className={styles.content}>
          <SkeletonWorkoutPlan />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <AppHeader title="Plan Antrenament" backHref="/clients" />
        <div className={styles.content}>
          <div className={styles.error}>
            <span>!</span> {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <AppHeader
        title={clientData?.name || 'Plan Antrenament'}
        backHref="/clients"
      />
      <div className={styles.content}>
        <div className={shellStyles.navRow}>
          <button
            className={shellStyles.navBackBtn}
            onClick={handleReset}
            aria-label="Înapoi la clienți"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className={shellStyles.planTabsToggle}>
            <button
              className={`${shellStyles.planTab} ${planTab === 'alimentar' ? shellStyles.planTabActive : ''}`}
              disabled={!mealPlanId}
              title={mealPlanId ? 'Deschide planul alimentar' : 'Nu există plan alimentar pentru acest client'}
              onClick={() => {
                if (!mealPlanId) return;
                setPlanTab('alimentar');
                router.push(`/meal-plan/${mealPlanId}`);
              }}
            >
              Plan alimentar
            </button>
            <button className={`${shellStyles.planTab} ${shellStyles.planTabActive}`}>Plan de antrenament</button>
          </div>
        </div>
        <WorkoutPlan plan={workoutPlan} clientData={clientData} />
      </div>
    </div>
  );
}

export default function WorkoutPlanPage() {
  return (
    <ProtectedRoute>
      <WorkoutPlanViewContent />
    </ProtectedRoute>
  );
}
