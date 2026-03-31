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
  const [regenerating, setRegenerating] = useState(false);
  const [regenProgress, setRegenProgress] = useState(0);
  const [regenStep, setRegenStep] = useState(0);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const fetchedRef = useRef(false);
  const abortControllerRef = useRef(null);

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
        console.log('Date primite de la API:', data);
        console.log('client_id din mealPlan:', data.mealPlan?.client_id);
        if (!data.mealPlan) throw new Error(data.error || 'Planul nu a fost găsit.');
        const { plan_data, daily_targets, client_id } = data.mealPlan;
        setMealPlan(plan_data);
        setNutritionalNeeds(daily_targets);
        const c = data.client || {};
        setClientData({
          clientId: client_id,
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

  // Oprește regenerarea dacă utilizatorul navighează
  useEffect(() => {
    return () => { abortControllerRef.current?.abort(); };
  }, []);

  const handleRegenerate = async (progressData) => {
    if (!clientData) return;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setRegenerating(true);
    setRegenStep(0);
    setRegenProgress(0);
    setError(null);
    setSuccessMessage(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Token de autentificare lipsă.');

      const body = {
        ...clientData,
        progress: progressData,
      };

      console.log('Regenerare plan - date trimise:', { clientId: body.clientId, progress: body.progress });

      const response = await fetch('/api/generate-meal-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      // Verifică dacă e răspuns JSON normal (progres optim, rate limit, eroare) sau streaming
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        if (data.type === 'optimal_progress') {
          // Progres optim - doar actualizăm greutatea, nu regenerăm
          setClientData(prev => ({ ...prev, weight: String(data.newWeight) }));
          setSuccessMessage(data.message);
          setRegenerating(false);
          return;
        }
        if (data.error) {
          // Rate limit sau alte erori
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            throw new Error(`${data.error}${retryAfter ? ` (${retryAfter}s)` : ''}`);
          }
          throw new Error(data.error);
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 429) {
          throw new Error('Prea multe cereri. Te rog așteaptă câteva secunde și încearcă din nou.');
        }
        if (response.status === 503) {
          throw new Error('Serverul este ocupat. Te rog încearcă din nou în câteva minute.');
        }
        throw new Error(errorData.error || 'Eroare la regenerarea planului alimentar');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'progress') {
            setRegenStep(event.day);
            setRegenProgress(Math.round((event.day / event.total) * 90));
          } else if (event.type === 'complete') {
            setRegenProgress(100);
            setMealPlan(event.plan);
            setNutritionalNeeds(event.nutritionalNeeds);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className={styles.container}>
      <AppHeader
        title={mealPlan?.clientName || 'Plan alimentar'}
        backHref="/clients"
      />

      <div className={styles.content}>
        {loading && !regenerating && <SkeletonMealPlan />}

        {regenerating && (
          <div className={styles.loadingWrapper}>
            <div className={styles.loadingBox}>
              <p className={styles.loadingTitle}>Se regenerează planul alimentar</p>
              <p className={styles.loadingStep}>
                {regenStep > 0 ? `Ziua ${regenStep} din 7...` : 'Se pregătește...'}
              </p>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${regenProgress}%` }}
                />
              </div>
              <div className={styles.progressDots}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <div
                    key={d}
                    className={`${styles.progressDot} ${
                      d < regenStep ? styles.progressDotDone :
                      d === regenStep ? styles.progressDotActive : ''
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {!loading && !regenerating && error && (
          <div className={styles.error}>
            <span className={styles.errorIcon}>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {!loading && !regenerating && successMessage && (
          <div className={styles.success}>
            <span className={styles.successIcon}>✓</span>
            <span>{successMessage}</span>
            <button className={styles.successClose} onClick={() => setSuccessMessage(null)}>✕</button>
          </div>
        )}

        {!loading && !regenerating && mealPlan && (
          <MealPlan
            plan={mealPlan}
            clientData={clientData}
            nutritionalNeeds={nutritionalNeeds}
            onReset={() => router.push('/clients')}
            onRegenerate={handleRegenerate}
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
