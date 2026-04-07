'use client';

import { useState, useEffect, useRef } from 'react';
import MealPlanTrainer from '@/app/components/MealPlanGenerator/MealPlanTrainer';
import styles from '@/app/meal-plan/meal-plan-view.module.css';

function SkeletonMealPlan() {
  return (
    <div className={styles.skeletonWrap}>
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
      <div className={styles.skeletonRightColumn}>
        <div className={styles.skeletonTabsRow}>
          <div className={styles.skeletonTabGroup}>
            {[1, 2, 3, 4, 5, 6, 7].map(i => (
              <div key={i} className={`${styles.shimmer} ${styles.skeletonTab}`} />
            ))}
          </div>
          <div className={`${styles.shimmer} ${styles.skeletonDownload}`} />
        </div>
        <div className={styles.skeletonBar} />
        <div className={styles.skeletonMealsGrid}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={`${styles.shimmer} ${styles.skeletonMealCard}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function InlineMealPlanView({ planId: initialPlanId, onBack, onViewProgress }) {
  const [currentPlanId, setCurrentPlanId] = useState(initialPlanId);
  const [planTab, setPlanTab] = useState('alimentar');
  const [mealPlan, setMealPlan] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [nutritionalNeeds, setNutritionalNeeds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [regenProgress, setRegenProgress] = useState(0);
  const [regenStep, setRegenStep] = useState(0);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const abortControllerRef = useRef(null);
  // Prevent re-fetch when currentPlanId updates after regeneration (data already loaded from stream)
  const skipFetchRef = useRef(false);

  useEffect(() => {
    if (skipFetchRef.current) {
      skipFetchRef.current = false;
      return;
    }
    let cancelled = false;
    setMealPlan(null);
    setLoading(true);
    setError(null);

    const token = localStorage.getItem('token');
    if (!token) {
      setError('Token de autentificare lipsă.');
      setLoading(false);
      return;
    }

    fetch(`/api/meal-plans/${currentPlanId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
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
          foodPreferences: c.food_preferences || '',
        });
      })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [currentPlanId]);

  useEffect(() => {
    return () => { abortControllerRef.current?.abort(); };
  }, []);

  // Auto-dismiss mesajul de succes după 4 secunde, ca planul să devină focusul principal
  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

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
        currentPlanCalories: nutritionalNeeds?.calories ?? null,
      };

      const response = await fetch('/api/generate-meal-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        if (data.type === 'optimal_progress') {
          setClientData(prev => ({ ...prev, weight: String(data.newWeight) }));
          setSuccessMessage(data.message);
          setRegenerating(false);
          return;
        }
        if (data.error) {
          const retryAfter = response.headers.get('Retry-After');
          throw new Error(`${data.error}${retryAfter ? ` (${retryAfter}s)` : ''}`);
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
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
            if (progressData?.currentWeight) {
              setClientData(prev => ({ ...prev, weight: String(parseFloat(progressData.currentWeight)) }));
            }
            if (event.planId && event.planId !== currentPlanId) {
              skipFetchRef.current = true;
              setCurrentPlanId(event.planId);
            }
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
    <div className={styles.content}>
      <div className={styles.navRow}>
        <button
          className={styles.navBackBtn}
          onClick={onBack}
          aria-label="Înapoi la clienți"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className={styles.planTabsToggle}>
          <button
            className={`${styles.planTab} ${planTab === 'alimentar' ? styles.planTabActive : ''}`}
            onClick={() => setPlanTab('alimentar')}
          >
            Plan alimentar
          </button>
          <button
            className={styles.planTab}
            disabled
            title="Va fi disponibil în curând"
          >
            Plan de antrenament
          </button>
        </div>
      </div>

      {loading && !regenerating && <SkeletonMealPlan />}

      {regenerating && (
        <div className={styles.loadingWrapper}>
          <div className={styles.loadingBox}>
            <p className={styles.loadingTitle}>Se regenerează planul alimentar</p>
            <p className={styles.loadingStep}>
              {regenStep > 0 ? `Ziua ${regenStep} din 7...` : 'Se pregătește...'}
            </p>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${regenProgress}%` }} />
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
        <MealPlanTrainer
          plan={mealPlan}
          clientData={clientData}
          nutritionalNeeds={nutritionalNeeds}
          onReset={onBack}
          onRegenerate={handleRegenerate}
          onViewProgress={onViewProgress ? () => {
            if (clientData?.clientId) {
              onViewProgress(clientData.clientId);
            }
          } : null}
        />
      )}
    </div>
  );
}
