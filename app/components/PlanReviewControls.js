'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from '@/app/meal-plan/meal-plan-view.module.css';
import clientStyles from '@/app/clients/clients.module.css';

export default function PlanReviewControls({
  type,
  planId,
  status,
  plan,
  dailyTargets,
  onPlanChange,
  onDailyTargetsChange,
  onStatusChange,
  externalDirty = false,
  onExternalDirtyChange,
}) {
  const { user } = useAuth();
  const [draftPlan, setDraftPlan] = useState(plan);
  const [internalDirty, setInternalDirty] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [approving, setApproving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sentInSession, setSentInSession] = useState(false);
  const latestWorkoutSaveRef = useRef({ dirty: false, plan: null, endpoint: '' });

  useEffect(() => {
    setDraftPlan(plan);
    setInternalDirty(false);
  }, [plan]);

  useEffect(() => {
    setSentInSession(false);
    setConfirmOpen(false);
    setMessage('');
    setError('');
  }, [planId]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const isTrainer = user?.role === 'trainer';
  const isApproved = sentInSession || (status || 'approved') === 'approved';
  const endpoint = type === 'meal' ? `/api/meal-plans/${planId}` : `/api/workout-plans/${planId}`;

  const reviewTitle = 'Plan în revizia antrenorului';
  const reviewText = 'Clientul nu vede încă acest plan. Verifică-l, ajustează-l dacă e nevoie, apoi trimite-l.';
  const dirty = type === 'meal' ? externalDirty : (externalDirty || internalDirty);

  useEffect(() => {
    latestWorkoutSaveRef.current = {
      dirty: type === 'workout' && dirty && !isApproved,
      plan: externalDirty ? plan : draftPlan,
      endpoint,
    };
  }, [dirty, draftPlan, endpoint, externalDirty, isApproved, plan, type]);

  const saveDraft = useCallback(async ({ silent = false } = {}) => {
    const planToSave = type === 'meal' || externalDirty ? plan : draftPlan;
    if (!dirty) return planToSave;
    if (isApproved) {
      if (type === 'meal' || externalDirty) onExternalDirtyChange?.(false);
      else setInternalDirty(false);
      return planToSave;
    }

    setSavingDraft(true);
    if (!silent) {
      setError('');
      setMessage('');
    }

    try {
      const token = localStorage.getItem('token');
      const payload = {
        action: 'update',
        plan_data: planToSave,
      };
      if (type === 'meal' && dailyTargets) {
        payload.daily_targets = dailyTargets;
      }

      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut salva modificările.');

      const updated = type === 'meal' ? data.mealPlan : data.workoutPlan;
      const updatedPlan = updated?.plan_data || planToSave;
      setDraftPlan(updatedPlan);
      onPlanChange?.(updatedPlan);
      if (type === 'meal' && updated?.daily_targets) onDailyTargetsChange?.(updated.daily_targets);
      const updatedStatus = updated?.approval_status || (isApproved ? 'approved' : 'pending_review');
      onStatusChange?.(updatedStatus);
      if (updatedStatus === 'approved') setSentInSession(true);
      if (type === 'meal' || externalDirty) onExternalDirtyChange?.(false);
      else setInternalDirty(false);
      if (!silent) setMessage('Modificările au fost salvate.');
      return updatedPlan;
    } catch (err) {
      console.error('[PlanReviewControls] Nu am putut salva draftul:', err);
      if (!silent) setError(err.message);
      throw err;
    } finally {
      setSavingDraft(false);
    }
  }, [dailyTargets, dirty, draftPlan, endpoint, externalDirty, isApproved, onDailyTargetsChange, onExternalDirtyChange, onPlanChange, onStatusChange, plan, type]);

  useEffect(() => {
    if (type !== 'workout' || !dirty || !planId || isApproved) return;
    const timer = setTimeout(() => {
      saveDraft({ silent: true }).catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [dirty, isApproved, planId, saveDraft, type]);

  useEffect(() => {
    return () => {
      const latest = latestWorkoutSaveRef.current;
      if (!latest.dirty || !latest.plan || !latest.endpoint) return;
      const token = localStorage.getItem('token');
      if (!token) return;
      fetch(latest.endpoint, {
        method: 'PATCH',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'update',
          plan_data: latest.plan,
        }),
      }).catch(() => {});
    };
  }, []);

  if (!isTrainer || !planId || !plan?.days) return null;

  if (isApproved) {
    return message ? (
      <div className={styles.reviewMessage}>{message}</div>
    ) : null;
  }

  const approvePlan = async () => {
    setApproving(true);
    setError('');
    setMessage('');

    try {
      if (dirty) await saveDraft({ silent: true });
      const token = localStorage.getItem('token');
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'approve' }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut trimite planul clientului.');

      const approved = type === 'meal' ? data.mealPlan : data.workoutPlan;
      setSentInSession(true);
      onStatusChange?.(approved?.approval_status || 'approved');
      onExternalDirtyChange?.(false);
      setInternalDirty(false);
      setConfirmOpen(false);
      setMessage('Planul a fost trimis clientului');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('planReviewStatusChanged', {
          detail: {
            type,
            status: 'approved',
            mealPlan: data.mealPlan || null,
            workoutPlan: data.workoutPlan || null,
          },
        }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className={styles.reviewPanel}>
      <div className={styles.reviewHeader}>
        <div>
          <span className={styles.reviewKicker}>În așteptare</span>
          <h3>{reviewTitle}</h3>
          <p>{reviewText}</p>
        </div>
        {!isApproved && (
          <div className={styles.reviewActions}>
            <button type="button" className={styles.reviewPrimaryBtn} onClick={() => setConfirmOpen(true)} disabled={approving}>
              {approving ? 'Se trimite...' : 'Trimite clientului'}
            </button>
          </div>
        )}
      </div>

      {message && <div className={styles.reviewMessage}>{message}</div>}
      {error && <div className={styles.reviewError}>{error}</div>}

      {confirmOpen && (
        <div className={clientStyles.modalOverlay} onClick={() => !approving && setConfirmOpen(false)}>
          <div className={clientStyles.confirmModal} onClick={(event) => event.stopPropagation()}>
            <div className={clientStyles.confirmIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            </div>
            <h3>Trimiți planul clientului?</h3>
            <p>
              Clientul va vedea acest plan în portal. Modificările nesalvate se salvează automat înainte de trimitere.
            </p>
            <div className={clientStyles.confirmActions}>
              <button className={clientStyles.cancelBtn} onClick={() => setConfirmOpen(false)} disabled={approving}>
                Anulează
              </button>
              <button className={clientStyles.saveBtn} onClick={approvePlan} disabled={approving || savingDraft}>
                {approving ? 'Se trimite...' : 'Trimite clientului'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
