'use client';

import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import PlanReviewControls from '@/app/components/PlanReviewControls';
import styles from '@/app/meal-plan/meal-plan-view.module.css';

// Lazy load MealPlanTrainer pentru performanță
const MealPlanTrainer = lazy(() => import('@/app/components/MealPlanGenerator/MealPlanTrainer'));

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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const mealDraftKey = (planId) => `mealPlanDraft:${planId}`;

function readMealDraft(planId) {
  if (typeof window === 'undefined' || !planId) return null;
  try {
    const raw = sessionStorage.getItem(mealDraftKey(planId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeMealDraft(planId, plan) {
  if (typeof window === 'undefined' || !planId || !plan) return;
  try {
    sessionStorage.setItem(mealDraftKey(planId), JSON.stringify({ plan, savedAt: Date.now() }));
  } catch {
    // sessionStorage may be full or blocked; the in-memory state still works.
  }
}

function clearMealDraft(planId) {
  if (typeof window === 'undefined' || !planId) return;
  try {
    sessionStorage.removeItem(mealDraftKey(planId));
  } catch {}
}

export default function InlineMealPlanView({ planId: initialPlanId, clientDataVersion, scrollContainerRef, onBack, onViewProgress, onViewWorkoutPlan, onEditClient, onDeleteClient }) {
  // DEBUG
  
  const [currentPlanId, setCurrentPlanId] = useState(initialPlanId);
  const [planTab, setPlanTab] = useState('alimentar');
  const [mealPlan, setMealPlan] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [planStatus, setPlanStatus] = useState('approved');
  const [mealPlanDirty, setMealPlanDirty] = useState(false);
  const [workoutPlanId, setWorkoutPlanId] = useState(null);

  // Scroll to top când se montează componenta
  useEffect(() => {
    scrollContainerRef?.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [scrollContainerRef]);
  const [nutritionalNeeds, setNutritionalNeeds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [regenProgress, setRegenProgress] = useState(0);
  const [regenStep, setRegenStep] = useState(0);
  const [regenMessage, setRegenMessage] = useState('Se pregătește...');
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const abortControllerRef = useRef(null);
  // Prevent re-fetch when currentPlanId updates after regeneration (data already loaded from stream)
  const skipFetchRef = useRef(false);
  const resolveWorkoutPlanId = useCallback(async (clientId, token, maxAttempts = 4) => {
    if (!clientId || !token) return null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const workoutRes = await fetch(`/api/workout-plans?clientId=${encodeURIComponent(clientId)}`, {
          headers: { 'Authorization': `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!workoutRes.ok) return null;
        const plansData = await workoutRes.json();
        const foundPlanId = plansData.plans?.[clientId]?.planId || null;
        if (foundPlanId) return foundPlanId;
      } catch {
        // Retry below
      }
      if (attempt < maxAttempts) {
        await delay(350);
      }
    }
    return null;
  }, []);

  useEffect(() => {
    if (skipFetchRef.current) {
      skipFetchRef.current = false;
      return;
    }
    let cancelled = false;
    setMealPlan(null);
    setMealPlanDirty(false);
    setWorkoutPlanId(null);
    setLoading(true);
    setError(null);

    // Scroll to top când se schimbă planul vizualizat
    scrollContainerRef?.current?.scrollTo({ top: 0, behavior: 'instant' });

    const token = localStorage.getItem('token');
    if (!token) {
      setError('Token de autentificare lipsă.');
      setLoading(false);
      return;
    }

    fetch(`/api/meal-plans/${currentPlanId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      cache: 'no-store',
    })
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        if (!data.mealPlan) throw new Error(data.error || 'Planul nu a fost găsit.');
        const { plan_data, daily_targets, client_id, approval_status } = data.mealPlan;
        const storedDraft = readMealDraft(currentPlanId);
        const canUseStoredDraft = (approval_status || 'approved') !== 'approved';
        if (!canUseStoredDraft) clearMealDraft(currentPlanId);
        setMealPlan(canUseStoredDraft && storedDraft?.plan ? storedDraft.plan : plan_data);
        setNutritionalNeeds(daily_targets);
        setPlanStatus(approval_status || 'approved');
        setMealPlanDirty(canUseStoredDraft && !!storedDraft?.plan);
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

        (async () => {
          const foundPlanId = await resolveWorkoutPlanId(client_id, token);
          if (!cancelled) setWorkoutPlanId(foundPlanId);
        })();
      })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [currentPlanId, resolveWorkoutPlanId, clientDataVersion, scrollContainerRef]);

  useEffect(() => {
    return () => { abortControllerRef.current?.abort(); };
  }, []);

  // Auto-dismiss mesajul de succes după 4 secunde, ca planul să devină focusul principal
  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  useEffect(() => {
    if (!regenerating) return;

    const timer = setInterval(() => {
      setRegenProgress(prev => {
        const cap = regenStep > 0 ? 84 : 30;
        if (prev >= cap) return prev;
        return Math.min(cap, prev + (regenStep > 0 ? 0.5 : 0.8));
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [regenerating, regenStep]);

  // Memoized regenerate handler pentru performanță
  const handleRegenerate = useCallback(async (progressData) => {
    if (!clientData) return;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setRegenerating(true);
    setRegenStep(0);
    setRegenProgress(0);
    setRegenMessage('Se pregătește...');
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
            const eventProgress = typeof event.progress === 'number' ? event.progress : null;
            if (event.phase === 'setup') {
              setRegenStep(0);
              setRegenProgress(prev => Math.max(prev, eventProgress ?? 8));
              setRegenMessage(event.message || 'Pregătim datele clientului...');
            } else if (event.phase === 'workout') {
              setRegenStep(7);
              setRegenProgress(prev => Math.max(prev, eventProgress ?? 92));
              setRegenMessage(event.message || 'Se generează planul de antrenament...');
            } else {
              setRegenStep(event.day || 0);
              setRegenProgress(prev => Math.max(
                prev,
                eventProgress ?? Math.round(((event.day || 0) / Math.max(event.total || 7, 1)) * 86)
              ));
              setRegenMessage(event.message || (event.day > 0 ? `Plan alimentar: ziua ${event.day} din ${event.total}...` : 'Selectare rețete potrivite...'));
            }
          } else if (event.type === 'complete') {
            setRegenProgress(100);
            setMealPlan(event.plan);
            setNutritionalNeeds(event.nutritionalNeeds);
            setPlanStatus('pending_review');
            setMealPlanDirty(false);
            clearMealDraft(event.planId || currentPlanId);
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
  }, [clientData, currentPlanId, nutritionalNeeds?.calories]);

  useEffect(() => {
    if (!currentPlanId || !mealPlan) return;
    if (mealPlanDirty) writeMealDraft(currentPlanId, mealPlan);
    else clearMealDraft(currentPlanId);
  }, [currentPlanId, mealPlan, mealPlanDirty]);

  // Memoized computed values
  const nutritionalNeedsMemo = useMemo(() => nutritionalNeeds, [nutritionalNeeds]);
  const saveMealPlanDraftNow = useCallback(async () => {
    if (!currentPlanId || !mealPlan || !mealPlanDirty) return;
    if (planStatus === 'approved') {
      setMealPlanDirty(false);
      clearMealDraft(currentPlanId);
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;

    const response = await fetch(`/api/meal-plans/${currentPlanId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: 'update',
        plan_data: mealPlan,
        daily_targets: nutritionalNeeds,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[InlineMealPlanView] Autosave meal plan failed:', data);
      throw new Error(data.error || 'Nu am putut salva automat modificările.');
    }
    setMealPlanDirty(false);
    setPlanStatus(data.mealPlan?.approval_status || 'pending_review');
    clearMealDraft(currentPlanId);
  }, [currentPlanId, mealPlan, mealPlanDirty, nutritionalNeeds, planStatus]);

  useEffect(() => {
    if (!mealPlanDirty || !mealPlan || !currentPlanId) return;
    const timer = setTimeout(() => {
      saveMealPlanDraftNow().catch((err) => {
        console.error('[InlineMealPlanView] Autosave meal plan failed:', err);
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [currentPlanId, mealPlan, mealPlanDirty, saveMealPlanDraftNow]);

  const handleOpenWorkoutPlan = useCallback(async () => {
    if (!onViewWorkoutPlan || !clientData?.clientId) return;

    let targetWorkoutPlanId = workoutPlanId;
    if (!targetWorkoutPlanId) {
      const token = localStorage.getItem('token');
      targetWorkoutPlanId = await resolveWorkoutPlanId(clientData.clientId, token, 6);
      if (targetWorkoutPlanId) {
        setWorkoutPlanId(targetWorkoutPlanId);
      }
    }

    if (targetWorkoutPlanId) {
      if (mealPlanDirty && mealPlan) writeMealDraft(currentPlanId, mealPlan);
      if (mealPlanDirty) {
        try {
          await saveMealPlanDraftNow();
        } catch (err) {
          console.error('[InlineMealPlanView] Nu am putut salva înainte de comutarea pe antrenament:', err);
        }
      }
      onViewWorkoutPlan(targetWorkoutPlanId);
    } else {
      setError('Planul de antrenament nu este încă disponibil pentru acest client.');
    }
  }, [clientData?.clientId, currentPlanId, mealPlan, mealPlanDirty, onViewWorkoutPlan, resolveWorkoutPlanId, saveMealPlanDraftNow, workoutPlanId]);

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
            disabled={!onViewWorkoutPlan}
            title={workoutPlanId ? 'Deschide planul de antrenament' : 'Caută planul de antrenament'}
            onClick={handleOpenWorkoutPlan}
          >
            Plan de antrenament
          </button>
        </div>
        {clientData?.clientId && (onEditClient || onDeleteClient) && (
          <div className={styles.navClientActions}>
            {onEditClient && (
              <button
                className={styles.navEditBtn}
                onClick={() => onEditClient(clientData.clientId)}
                aria-label="Editează clientul"
                title="Editează clientul"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Editează
              </button>
            )}
            {onDeleteClient && (
              <button
                className={styles.navDeleteBtn}
                onClick={() => onDeleteClient(clientData.clientId)}
                aria-label="Şterge clientul"
                title="Şterge clientul"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {loading && !regenerating && <SkeletonMealPlan />}

      {regenerating && (
        <div className={styles.loadingWrapper}>
          <div className={styles.loadingBox}>
            <p className={styles.loadingTitle}>Se regenerează planul alimentar</p>
            <p className={styles.loadingStep}>
              {regenMessage || (regenStep > 0 ? `Ziua ${regenStep} din 7...` : 'Se pregătește...')}
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
          <span className={styles.errorIcon}>!</span>
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
        <>
        <PlanReviewControls
          type="meal"
          planId={currentPlanId}
          status={planStatus}
          plan={mealPlan}
          dailyTargets={nutritionalNeedsMemo}
          onPlanChange={setMealPlan}
          onDailyTargetsChange={setNutritionalNeeds}
          onStatusChange={setPlanStatus}
          externalDirty={mealPlanDirty}
          onExternalDirtyChange={(dirty) => {
            setMealPlanDirty(dirty);
            if (!dirty) clearMealDraft(currentPlanId);
          }}
        />
        <Suspense fallback={<SkeletonMealPlan />}>
          <MealPlanTrainer
            plan={mealPlan}
            clientData={clientData}
            nutritionalNeeds={nutritionalNeedsMemo}
            editableAmounts={planStatus !== 'approved'}
            onPlanChange={setMealPlan}
            onPlanDirtyChange={setMealPlanDirty}
            hideReviewActions={planStatus === 'pending_review'}
            onReset={onBack}
            onRegenerate={handleRegenerate}
            onViewProgress={onViewProgress ? (() => {
              if (clientData?.clientId) {
                onViewProgress(clientData.clientId);
              }
            }) : undefined}
          />
        </Suspense>
        </>
      )}
    </div>
  );
}
