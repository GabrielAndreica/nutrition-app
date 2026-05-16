'use client';

import { useEffect, useState } from 'react';
import PlanReviewControls from '@/app/components/PlanReviewControls';
import WorkoutPlan from '@/app/components/WorkoutPlanGenerator/WorkoutPlan';
import styles from '@/app/meal-plan/meal-plan-view.module.css';
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
        <div className={`${styles.shimmer} ${styles.skeletonMealCard}`} />
      </div>
    </div>
  );
}

export default function InlineWorkoutPlanView({ planId, clientDataVersion, scrollContainerRef, onBack, onViewMealPlan, onViewProgress, onEditClient, onDeleteClient }) {
  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [planStatus, setPlanStatus] = useState('approved');
  const [workoutPlanDirty, setWorkoutPlanDirty] = useState(false);
  const [mealPlanId, setMealPlanId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [planTab, setPlanTab] = useState('antrenament');

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      setWorkoutPlan(null);
      setWorkoutPlanDirty(false);
      scrollContainerRef?.current?.scrollTo({ top: 0, behavior: 'instant' });

      const token = localStorage.getItem('token');
      if (!token) {
        setError('Token de autentificare lipsă.');
        setLoading(false);
        return;
      }

      fetch(`/api/workout-plans/${planId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
        .then(res => res.json())
        .then(async data => {
          if (cancelled) return;
          if (!data.workoutPlan) throw new Error(data.error || 'Planul nu a fost găsit.');
          setWorkoutPlan(data.workoutPlan.plan_data || data.workoutPlan);
          setPlanStatus(data.workoutPlan.approval_status || 'approved');
          const clientId = data.workoutPlan?.client_id || null;
          setClientData(data.client ? { ...data.client, id: clientId } : null);
          if (!clientId) return;
          const maxAttempts = 4;
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const mealRes = await fetch(`/api/meal-plans?clientId=${encodeURIComponent(clientId)}`, {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            });
            if (!mealRes.ok) break;
            const mealData = await mealRes.json();
            const foundMealPlanId = mealData.plans?.[clientId]?.planId || null;
            if (foundMealPlanId) {
              setMealPlanId(foundMealPlanId);
              break;
            }
            if (attempt < maxAttempts) await delay(500);
          }
        })
        .catch(err => {
          if (!cancelled) setError(err.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });

    return () => { cancelled = true; };
  }, [planId, scrollContainerRef, clientDataVersion]);

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
            disabled={!onViewMealPlan || !mealPlanId}
            title={mealPlanId ? 'Deschide planul alimentar' : 'Nu există plan alimentar pentru acest client'}
            onClick={() => {
              if (!onViewMealPlan || !mealPlanId) return;
              setPlanTab('alimentar');
              onViewMealPlan(mealPlanId);
            }}
          >
            Plan alimentar
          </button>
          <button className={`${styles.planTab} ${styles.planTabActive}`}>Plan de antrenament</button>
        </div>
        {clientData?.id && (onEditClient || onDeleteClient) && (
          <div className={styles.navClientActions}>
            {onEditClient && (
              <button
                className={styles.navEditBtn}
                onClick={() => onEditClient(clientData.id)}
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
                onClick={() => onDeleteClient(clientData.id)}
                aria-label="Șterge clientul"
                title="Șterge clientul"
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

      {loading && <SkeletonWorkoutPlan />}

      {!loading && error && (
        <div className={styles.error}>
          <span className={styles.errorIcon}>!</span>
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && workoutPlan && (
        <>
        <PlanReviewControls
          type="workout"
          planId={planId}
          status={planStatus}
          plan={workoutPlan}
          onPlanChange={setWorkoutPlan}
          onStatusChange={setPlanStatus}
          externalDirty={workoutPlanDirty}
          onExternalDirtyChange={setWorkoutPlanDirty}
        />
        <WorkoutPlan
          plan={workoutPlan}
          clientData={clientData}
          editableSets={planStatus !== 'approved'}
          onPlanChange={setWorkoutPlan}
          onPlanDirtyChange={setWorkoutPlanDirty}
          hideReviewActions={planStatus === 'pending_review'}
          onViewProgress={onViewProgress ? (() => {
              if (clientData?.id) {
                onViewProgress(clientData.id);
              }
            }) : undefined}
        />
        </>
      )}
    </div>
  );
}
