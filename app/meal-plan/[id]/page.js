'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import MealPlan from '@/app/components/MealPlanGenerator/MealPlan';
import AppHeader from '@/app/components/AppHeader';
import styles from '../meal-plan-view.module.css';

function SkeletonMealPlan() {
  return (
    <div className={styles.skeletonWrap}>
      {/* Client header skeleton */}
      <div className={styles.skeletonClientHeader}>
        <div className={styles.skeletonNameBlock}>
          <div className={`${styles.shimmer} ${styles.skeletonName}`} />
          <div className={`${styles.shimmer} ${styles.skeletonSub}`} />
        </div>
        <div className={styles.skeletonStats}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={`${styles.shimmer} ${styles.skeletonStat}`} />
          ))}
        </div>
      </div>

      {/* Right column */}
      <div className={styles.skeletonRightColumn}>
        {/* Tabs row */}
        <div className={styles.skeletonTabsRow}>
          <div className={styles.skeletonTabGroup}>
            {[1, 2, 3, 4, 5, 6, 7].map(i => (
              <div key={i} className={`${styles.shimmer} ${styles.skeletonTab}`} />
            ))}
          </div>
          <div className={`${styles.shimmer} ${styles.skeletonDownload}`} />
        </div>

        {/* Day totals bar */}
        <div className={styles.skeletonBar} />

        {/* Meal cards grid */}
        <div className={styles.skeletonMealsGrid}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={`${styles.shimmer} ${styles.skeletonMealCard}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MealPlanViewContent() {
  const router = useRouter();
  const { id } = useParams();
  const [mealPlan, setMealPlan] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [nutritionalNeeds, setNutritionalNeeds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    if (fetchedRef.current) return; // previne dubla execuție din React Strict Mode
    fetchedRef.current = true;
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Token de autentificare lipsă.');
      setLoading(false);
      return;
    }

    fetch(`/api/meal-plans/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (!data.mealPlan) throw new Error(data.error || 'Planul nu a fost găsit.');
        const { plan_data, daily_targets } = data.mealPlan;
        setMealPlan(plan_data);
        setNutritionalNeeds(daily_targets);
        const c = data.client || {};
        setClientData({
          name: c.name || plan_data.clientName,
          age: c.age ? String(c.age) : undefined,
          weight: c.weight ? String(c.weight) : undefined,
          height: c.height ? String(c.height) : undefined,
          gender: c.gender,
          goal: c.goal,
          activityLevel: c.activity_level,
          dietType: c.diet_type,
          allergies: c.allergies,
          mealsPerDay: c.meals_per_day ? String(c.meals_per_day) : undefined,
        });
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className={styles.container}>
      <AppHeader
        title={mealPlan?.clientName || 'Plan alimentar'}
        backHref="/clients"
      />

      <div className={styles.content}>
        {loading && <SkeletonMealPlan />}

        {!loading && error && (
          <div className={styles.error}>
            <span className={styles.errorIcon}>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {!loading && mealPlan && (
          <MealPlan
            plan={mealPlan}
            clientData={clientData}
            nutritionalNeeds={nutritionalNeeds}
            onReset={() => router.push('/clients')}
          />
        )}
      </div>
    </div>
  );
}

export default function MealPlanViewPage() {
  return (
    <ProtectedRoute>
      <MealPlanViewContent />
    </ProtectedRoute>
  );
}
