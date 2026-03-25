'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import MealPlan from '@/app/components/MealPlanGenerator/MealPlan';
import styles from '@/app/generator-plan/generator.module.css';

function MealPlanViewContent() {
  const router = useRouter();
  const { id } = useParams();
  const [mealPlan, setMealPlan] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [nutritionalNeeds, setNutritionalNeeds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
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
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.headerTitle}>
            <button className={styles.backBtn} onClick={() => router.push('/clients')}>
              ← Înapoi la clienți
            </button>
            <h1>
              {mealPlan ? `Plan alimentar — ${mealPlan.clientName}` : 'Plan alimentar'}
            </h1>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {loading && (
          <div className={styles.loadingWrapper}>
            <div className={styles.loadingBox}>
              <p className={styles.loadingTitle}>Se încarcă planul...</p>
            </div>
          </div>
        )}

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
