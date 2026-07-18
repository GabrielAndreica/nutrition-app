'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './meal-plan.module.css';
import cStyles from '../../clients/clients.module.css';

const clonePlan = (value) => JSON.parse(JSON.stringify(value || {}));
const roundMacro = (value) => Math.round((Number(value) || 0) * 10) / 10;
const roundKcal = (value) => Math.round(Number(value) || 0);

function getMealImageUrl(meal = {}) {
  return String(meal.imageUrl || meal.image_url || '').trim();
}

function getMealImageFallbackUrl(meal = {}) {
  return String(meal.imageFallbackUrl || meal.image_fallback_url || '').trim();
}

function collectMealImageUrls(plan) {
  const urls = new Set();
  for (const day of plan?.days || []) {
    for (const meal of day?.meals || []) {
      const url = getMealImageUrl(meal);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

function recalculateDay(day) {
  if (!day?.meals) return day;

  for (const meal of day.meals) {
    const totals = (meal.foods || []).reduce((acc, food) => ({
      calories: acc.calories + (Number(food.calories) || 0),
      protein: acc.protein + (Number(food.protein) || 0),
      carbs: acc.carbs + (Number(food.carbs) || 0),
      fat: acc.fat + (Number(food.fat) || 0),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

    meal.mealTotals = {
      calories: roundKcal(totals.calories),
      protein: roundMacro(totals.protein),
      carbs: roundMacro(totals.carbs),
      fat: roundMacro(totals.fat),
    };
  }

  const dayTotals = day.meals.reduce((acc, meal) => ({
    calories: acc.calories + (Number(meal.mealTotals?.calories) || 0),
    protein: acc.protein + (Number(meal.mealTotals?.protein) || 0),
    carbs: acc.carbs + (Number(meal.mealTotals?.carbs) || 0),
    fat: acc.fat + (Number(meal.mealTotals?.fat) || 0),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  day.dailyTotals = {
    calories: roundKcal(dayTotals.calories),
    protein: roundMacro(dayTotals.protein),
    carbs: roundMacro(dayTotals.carbs),
    fat: roundMacro(dayTotals.fat),
  };

  return day;
}

function updateFoodAmount(plan, dayIndex, mealIndex, foodIndex, nextAmountRaw) {
  const nextPlan = clonePlan(plan);
  const food = nextPlan.days?.[dayIndex]?.meals?.[mealIndex]?.foods?.[foodIndex];
  if (!food) return nextPlan;

  const oldAmount = Math.max(1, Number(food.amount) || 1);
  const nextAmount = Math.max(5, Math.round((Number(nextAmountRaw) || 5) / 5) * 5);
  const ratio = nextAmount / oldAmount;
  const unit = food.unit || 'g';

  food.amount = nextAmount;
  food.displayAmount = `${nextAmount}${unit}`;
  food.calories = roundKcal((Number(food.calories) || 0) * ratio);
  food.protein = roundMacro((Number(food.protein) || 0) * ratio);
  food.carbs = roundMacro((Number(food.carbs) || 0) * ratio);
  food.fat = roundMacro((Number(food.fat) || 0) * ratio);

  recalculateDay(nextPlan.days[dayIndex]);
  return nextPlan;
}

export default function MealPlan({
  plan,
  clientData,
  nutritionalNeeds,
  onReset,
  onRegenerate,
  onSubmitProgress,
  onViewProgress,
  progressCooldownUntil,
  onProgressToggle,
  workoutOnlyMode,
  initialShowProgress,
  editableAmounts = false,
  onPlanChange,
  onPlanDirtyChange,
  hideReviewActions = false,
  lockedAfterDay = null,
  currentPlanDay = 0,
  dayStatus = {},
  onFinishMeals,
  onBack,
}) {
  const { user } = useAuth();
  const [activeDay, setActiveDay] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showProgress, setShowProgress] = useState(!!initialShowProgress);
  const [weightHistory, setWeightHistory] = useState([]);
  const [stagnationWeeks, setStagnationWeeks] = useState(0);
  const [stagnationInfo, setStagnationInfo] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [progressErrors, setProgressErrors] = useState({});
  const [progressSubmitting, setProgressSubmitting] = useState(false);
  const [progressSuccess, setProgressSuccess] = useState(false);
  const [progressSubmitError, setProgressSubmitError] = useState(null);
  const [progressSentBanner, setProgressSentBanner] = useState(null);
  const [mealChecks, setMealChecks] = useState({});
  const [mealChecksLoaded, setMealChecksLoaded] = useState(false);
  const [loadedMealImages, setLoadedMealImages] = useState({});
  const [progressData, setProgressData] = useState({
    currentWeight: clientData?.weight || '',
    adherence: '',
    energyLevel: '',
    hungerLevel: '',
    notes: '',
    workoutAdherence: '',
    workoutDifficulty: '',
    workoutNotes: '',
    pump: '',
    generalFatigue: '',
    muscleSoreness: '',
  });
  const [progressStep, setProgressStep] = useState(1);
  const safeCurrentPlanDay = Math.max(0, Math.min(7, Number(currentPlanDay) || 0));
  const currentDay = plan && plan.days ? plan.days[activeDay] : null;
  const cooldownDate = progressCooldownUntil ? new Date(progressCooldownUntil) : null;
  const progressInCooldown = !!(cooldownDate && cooldownDate > new Date());
  const mealPlanProgressKey = String(
    plan?.id ||
    plan?.planId ||
    plan?.createdAt ||
    plan?.created_at ||
    plan?.days?.length ||
    'plan'
  );

  useEffect(() => {
    const urls = collectMealImageUrls(plan);
    if (!urls.length) {
      setLoadedMealImages({});
      return undefined;
    }

    let cancelled = false;
    setLoadedMealImages(prev => {
      const next = {};
      for (const url of urls) {
        if (prev[url]) next[url] = true;
      }
      return next;
    });

    for (const url of urls) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (cancelled) return;
        setLoadedMealImages(prev => prev[url] ? prev : { ...prev, [url]: true });
      };
      img.onerror = () => {
        if (cancelled) return;
        setLoadedMealImages(prev => prev[url] ? prev : { ...prev, [url]: true });
      };
      img.src = url;
    }

    return () => { cancelled = true; };
  }, [plan]);

  useEffect(() => {
    if (!onFinishMeals || !plan?.days?.length) return;
    setActiveDay(Math.min(safeCurrentPlanDay, plan.days.length - 1));
  }, [onFinishMeals, plan?.days?.length, safeCurrentPlanDay]);

  useEffect(() => {
    if (!onFinishMeals || !plan?.days?.length) return;

    let cancelled = false;
    setMealChecksLoaded(false);

    async function loadMealChecks() {
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('Token lipsă.');

        const response = await fetch(`/api/user/daily-progress?mealPlanKey=${encodeURIComponent(mealPlanProgressKey)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Nu am putut citi mesele bifate.');

        if (!cancelled) {
          setMealChecks(data.mealChecks && typeof data.mealChecks === 'object' ? data.mealChecks : {});
        }
      } catch (err) {
        console.error('Meal checks sync load failed:', err);
        if (!cancelled) setMealChecks({});
      } finally {
        if (!cancelled) setMealChecksLoaded(true);
      }
    }

    loadMealChecks();
    return () => { cancelled = true; };
  }, [mealPlanProgressKey, onFinishMeals, plan?.days?.length]);

  useEffect(() => {
    if (!onFinishMeals || !plan?.days?.length || !mealChecksLoaded) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('/api/user/daily-progress', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mealPlanKey: mealPlanProgressKey,
        mealChecks,
      }),
    }).then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Nu am putut salva mesele bifate.');
      }
    }).catch((err) => {
      console.error('Meal checks sync save failed:', err);
    });
  }, [mealChecks, mealChecksLoaded, mealPlanProgressKey, onFinishMeals, plan?.days?.length]);

  useEffect(() => {
    if (!onFinishMeals || !plan?.days?.length || !mealChecksLoaded) return;

    setMealChecks(prev => {
      let changed = false;
      const next = { ...prev };

      plan.days.forEach((day, dayIndex) => {
        const dayKey = String(dayIndex);
        if (dayStatus[dayKey] !== true) return;

        const nextDay = { ...(next[dayKey] || {}) };
        (day.meals || []).forEach((_, mealIndex) => {
          const mealKey = String(mealIndex);
          if (nextDay[mealKey] !== true) {
            nextDay[mealKey] = true;
            changed = true;
          }
        });
        next[dayKey] = nextDay;
      });

      return changed ? next : prev;
    });
  }, [dayStatus, mealChecksLoaded, onFinishMeals, plan?.days]);

  const goalLabels = {
    weight_loss: 'Slăbit',
    muscle_gain: 'Creștere masă musculară',
    maintenance: 'Menținere',
    recomposition: 'Recompoziție corporală',
  };

  const dietLabels = {
    omnivore: 'Omnivor',
    vegetarian: 'Vegetarian',
    vegan: 'Vegan',
  };

  const dayNames = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
  const dayNamesShort = ['Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ', 'Du'];

  const mealTypeLabels = {
    'Masa 1': { name: 'Masa 1' },
    'Masa 2': { name: 'Masa 2' },
    'Masa 3': { name: 'Masa 3' },
    'Gustare': { name: 'Gustare' },
    'Gustare 1': { name: 'Gustare 1' },
    'Gustare 2': { name: 'Gustare 2' },
    'Breakfast': { name: 'Mic dejun' },
    'Lunch': { name: 'Prânz' },
    'Dinner': { name: 'Cină' },
    'Snack': { name: 'Gustare' },
    'Snack 1': { name: 'Gustare 1' },
    'Snack 2': { name: 'Gustare 2' },
    breakfast: { name: 'Mic dejun' },
    lunch: { name: 'Prânz' },
    dinner: { name: 'Cină' },
    snack: { name: 'Gustare' },
    'Mic Dejun': { name: 'Mic dejun' },
    'Prânz': { name: 'Prânz' },
    'Cină': { name: 'Cină' },
  };

  const getMealLabel = (mealType) => {
    return mealTypeLabels[mealType] || { name: mealType };
  };

  const handleDownload = async () => {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const clientId = clientData?.clientId || clientData?.id;
      if (user?.role === 'trainer' && clientId) {
        const token = localStorage.getItem('token');
        const usageRes = await fetch('/api/client-usage/record', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ clientId, reason: 'meal_plan_pdf_export' }),
        });
        const usageData = await usageRes.json().catch(() => ({}));
        if (!usageRes.ok) {
          alert(usageData.error || 'Nu am putut exporta PDF-ul din cauza limitei de clienți.');
          return;
        }
      }

      const { generateMealPlanPDF } = await import('./generatePDF');
      generateMealPlanPDF(plan, clientData, nutritionalNeeds);
    } finally {
      setPdfLoading(false);
    }
  };

  const handleProgressChange = (e) => {
    const { name, value } = e.target;
    setProgressData(prev => ({ ...prev, [name]: value }));
  };

  // Încarcă istoricul greutății când se deschide modalul
  const loadWeightHistory = async () => {
    if (!clientData?.clientId) return;
    
    setLoadingHistory(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/clients/${clientData.clientId}/weight-history`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        setWeightHistory(data.weightHistory || []);
        setStagnationWeeks(data.stagnationWeeks || 0);
        setStagnationInfo(data.stagnationInfo || null);
      }
    } catch (err) {
      console.error('Eroare la încărcarea istoricului:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Deschide modalul și încarcă istoricul
  const handleOpenProgress = () => {
    setProgressErrors({});
    setProgressSubmitError(null);
    setProgressStep(1);
    setShowProgress(true);
    loadWeightHistory();
    if (onProgressToggle) onProgressToggle(true);
  };

  // Auto-dismiss banner trimis progres după 6 secunde
  useEffect(() => {
    if (!progressSentBanner) return;
    const t = setTimeout(() => setProgressSentBanner(null), 6000);
    return () => clearTimeout(t);
  }, [progressSentBanner]);

  const validateStep1 = () => {
    const errors = {};
    const w = progressData.currentWeight;
    if (!w && w !== 0) {
      errors.currentWeight = 'Greutatea este obligatorie.';
    } else {
      const num = parseFloat(w);
      if (isNaN(num)) errors.currentWeight = 'Introdu o valoare numerică validă (ex: 73.5).';
      else if (num < 30) errors.currentWeight = 'Greutatea nu poate fi mai mică de 30 kg.';
      else if (num > 300) errors.currentWeight = 'Greutatea nu poate depăși 300 kg.';
    }
    if (!progressData.adherence) errors.adherence = 'Selectează respectarea planului alimentar.';
    if (!progressData.energyLevel) errors.energyLevel = 'Selectează nivelul de energie.';
    if (!progressData.hungerLevel) errors.hungerLevel = 'Selectează nivelul de foame.';
    setProgressErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateStep2 = () => {
    const errors = {};
    if (!progressData.workoutAdherence) errors.workoutAdherence = 'Selectează respectarea planului de antrenament.';
    if (!progressData.workoutDifficulty) errors.workoutDifficulty = 'Selectează nivelul de dificultate.';
    setProgressErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleProgressSubmit = async () => {
    if (!validateStep2()) return;

    if (onSubmitProgress) {
      // Modul client: trimite progresul antrenorului
      setProgressSubmitting(true);
      setProgressSuccess(false);
      setProgressSubmitError(null);
      try {
        const result = await onSubmitProgress({
          ...progressData,
          weeksNoChange: String(stagnationWeeks),
        });
        if (result?.success) {
          setShowProgress(false);
          setProgressStep(1);
          if (onProgressToggle) onProgressToggle(false);
          setProgressSentBanner('Progresul a fost trimis către antrenor. Vei putea trimite din nou peste 7 zile.');
        }
      } catch (err) {
        setProgressSubmitError(err.message || 'Eroare la trimitere. Încearcă din nou.');
      } finally {
        setProgressSubmitting(false);
      }
    } else if (onRegenerate) {
      // Modul antrenor: regenerează planul
      onRegenerate({
        ...progressData,
        weeksNoChange: String(stagnationWeeks),
      });
      setShowProgress(false);
    }
  };

  const getMealDayState = (dayIndex) => {
    const dayCompleted = dayStatus[String(dayIndex)] === true;
    const dayDisabled = dayIndex < safeCurrentPlanDay && !dayCompleted;
    const weekCompleted = safeCurrentPlanDay >= 7;
    const dayLocked = dayDisabled || dayIndex > safeCurrentPlanDay || (lockedAfterDay !== null && dayIndex > lockedAfterDay);

    return {
      dayCompleted,
      disabled: progressInCooldown || dayLocked || dayCompleted || weekCompleted,
    };
  };

  const isMealChecked = (dayIndex, mealIndex) => {
    const dayKey = String(dayIndex);
    const mealKey = String(mealIndex);
    return dayStatus[dayKey] === true || mealChecks[dayKey]?.[mealKey] === true;
  };

  const handleMealCheckToggle = (mealIndex) => {
    if (!onFinishMeals || getMealDayState(activeDay).disabled) return;

    setMealChecks(prev => {
      const dayKey = String(activeDay);
      const mealKey = String(mealIndex);
      const nextDay = { ...(prev[dayKey] || {}) };
      nextDay[mealKey] = !nextDay[mealKey];

      return { ...prev, [dayKey]: nextDay };
    });
  };

  if (!workoutOnlyMode && (!plan || !plan.days || plan.days.length === 0)) {
    return <div className={styles.container}>Nu s-a putut genera planul.</div>;
  }

  const cooldownDateWO = progressCooldownUntil ? new Date(progressCooldownUntil) : null;
  const progressInCooldownWO = !!(cooldownDateWO && cooldownDateWO > new Date());
  const progressDaysLeftWO = progressInCooldownWO
    ? Math.ceil((cooldownDateWO - new Date()) / (1000 * 60 * 60 * 24))
    : 0;

  /* ── Workout-only mode: show just the progress button (identical to meal plan button) ── */
  if (workoutOnlyMode && !showProgress && onSubmitProgress) {
    return (
      <div style={{ padding: '0 0 16px' }}>
        <button
          className={`${styles.updateProgressBtn} ${progressInCooldownWO ? styles.updateProgressBtnLocked : ''}`}
          onClick={() => { if (!progressInCooldownWO) handleOpenProgress(); }}
          disabled={progressInCooldownWO}
          title={progressInCooldownWO ? `Disponibil în ${progressDaysLeftWO} ${progressDaysLeftWO === 1 ? 'zi' : 'zile'}` : undefined}
        >
          {progressInCooldownWO ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              {`Disponibil în ${progressDaysLeftWO} ${progressDaysLeftWO === 1 ? 'zi' : 'zile'}`}
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                <path d="M16 16h5v5"/>
              </svg>
              Trimite progres
            </>
          )}
        </button>
      </div>
    );
  }

  const canEditAmounts = editableAmounts && user?.role === 'trainer' && typeof onPlanChange === 'function';

  const handleFoodAmountChange = (mealIndex, foodIndex, nextAmount) => {
    const nextPlan = updateFoodAmount(plan, activeDay, mealIndex, foodIndex, nextAmount);
    onPlanChange?.(nextPlan);
    onPlanDirtyChange?.(true);
  };

  const dayCaloriesTotal = Number(currentDay?.dailyTotals?.calories)
    || (currentDay?.meals || []).reduce((sum, meal) => sum + (Number(meal.mealTotals?.calories) || 0), 0);
  const dayCaloriesConsumed = (currentDay?.meals || []).reduce((sum, meal, mealIndex) => {
    return isMealChecked(activeDay, mealIndex)
      ? sum + (Number(meal.mealTotals?.calories) || 0)
      : sum;
  }, 0);
  const dayCaloriesProgress = dayCaloriesTotal > 0
    ? Math.min(100, Math.round((dayCaloriesConsumed / dayCaloriesTotal) * 100))
    : 0;
  const activeMealDayState = getMealDayState(activeDay);
  const isActiveCalendarDay = activeDay === safeCurrentPlanDay && safeCurrentPlanDay < 7;
  const isReadOnlyDay = !isActiveCalendarDay || activeMealDayState.disabled;
  const canEditAmountsForDay = canEditAmounts && !activeMealDayState.disabled;
  const allActiveMealsChecked = !!currentDay?.meals?.length &&
    currentDay.meals.every((_, mealIndex) => isMealChecked(activeDay, mealIndex));
  const canFinalizeMealsDay = !!onFinishMeals && allActiveMealsChecked && !activeMealDayState.disabled;

  /* ── Inline Progress Page (client mode) ── */
  if (showProgress && onSubmitProgress) {
    const closeProgress = () => { setShowProgress(false); setProgressStep(1); if (onProgressToggle) onProgressToggle(false); };
    return (
      <div className={cStyles.addPage} style={{ paddingTop: 0 }}>
        <div className={cStyles.addPageShell}>

          {/* Nav */}
          <div className={cStyles.addPageNav}>
            <button type="button" className={cStyles.addFormBackBtn} onClick={() => {
              if (progressStep === 2) { setProgressStep(1); setProgressErrors({}); }
              else closeProgress();
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className={cStyles.addPageTitle}>Actualizare progres</span>
          </div>

          {/* Wizard header */}
          <div className={cStyles.addWizardHeader}>
            <div className={cStyles.addWizardMeta}>
              <span className={cStyles.addWizardStep}>Pasul {progressStep} din 2</span>
              <span className={cStyles.addWizardHint}>{progressStep === 1 ? 'Nutriție' : 'Antrenament'}</span>
            </div>
            <div className={cStyles.addWizardProgress}>
              <span style={{ width: progressStep === 1 ? '50%' : '100%' }} />
            </div>
          </div>

          {/* Form */}
          <form className={cStyles.addPageForm} onSubmit={e => e.preventDefault()}>

            {/* ── Pasul 1: Nutriție ── */}
            {progressStep === 1 && (
              <>
                <div className={cStyles.addStepTriple}>

                  {/* Secțiunea 01 — Greutate */}
                  <div className={cStyles.addSection}>
                    <div className={cStyles.addSectionHeader}>
                      <span className={cStyles.addSectionNum}>01</span>
                      <span className={cStyles.addSectionTitle}>Greutate curentă</span>
                    </div>
                    <div className={cStyles.addField}>
                      <label>Greutate (kg) *</label>
                      <div className={cStyles.inputUnit}>
                        <input
                          type="number"
                          name="currentWeight"
                          value={progressData.currentWeight}
                          onChange={handleProgressChange}
                          step="0.1" min="30" max="300"
                          placeholder="ex: 73.5"
                          className={progressErrors.currentWeight ? cStyles.addFieldErrorInput : ''}
                        />
                        <span>kg</span>
                      </div>
                      {progressErrors.currentWeight && <span className={cStyles.addFieldError}>{progressErrors.currentWeight}</span>}
                      {!progressErrors.currentWeight && clientData?.weight && progressData.currentWeight && (
                        <span style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                          {(() => {
                            const diff = (parseFloat(progressData.currentWeight) - parseFloat(clientData.weight)).toFixed(1);
                            return `${diff > 0 ? '+' : ''}${diff} kg față de ultima înregistrare`;
                          })()}
                        </span>
                      )}
                    </div>
                    {loadingHistory && <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>Se încarcă istoricul...</p>}
                    {weightHistory.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Istoric recent</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {weightHistory.slice(0, 3).map((entry, idx) => (
                            <div key={entry.id || idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#374151' }}>
                              <span>{new Date(entry.recorded_at).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })}</span>
                              <span style={{ fontWeight: 600 }}>{entry.weight} kg</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Secțiunea 02 — Cum te-ai simțit */}
                  <div className={cStyles.addSection}>
                    <div className={cStyles.addSectionHeader}>
                      <span className={cStyles.addSectionNum}>02</span>
                      <span className={cStyles.addSectionTitle}>Cum te-ai simțit</span>
                    </div>
                    <div className={cStyles.addField}>
                      <label>Respectare plan alimentar *</label>
                      <div className={cStyles.seg}>
                        {[{ v: 'complet', l: 'Complet' }, { v: 'partial', l: 'Parțial' }, { v: 'deloc', l: 'Deloc' }].map(({ v, l }) => (
                          <button key={v} type="button"
                            className={`${cStyles.segBtn} ${progressData.adherence === v ? cStyles.segOn : ''}`}
                            onClick={() => { setProgressData(p => ({ ...p, adherence: v })); setProgressErrors(e => ({ ...e, adherence: undefined })); }}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {progressErrors.adherence && <span className={cStyles.addFieldError}>{progressErrors.adherence}</span>}
                    </div>
                    <div className={cStyles.addField}>
                      <label>Nivel energie *</label>
                      <div className={cStyles.seg}>
                        {[{ v: 'scazut', l: 'Scăzut' }, { v: 'normal', l: 'Normal' }, { v: 'ridicat', l: 'Ridicat' }].map(({ v, l }) => (
                          <button key={v} type="button"
                            className={`${cStyles.segBtn} ${progressData.energyLevel === v ? cStyles.segOn : ''}`}
                            onClick={() => { setProgressData(p => ({ ...p, energyLevel: v })); setProgressErrors(e => ({ ...e, energyLevel: undefined })); }}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {progressErrors.energyLevel && <span className={cStyles.addFieldError}>{progressErrors.energyLevel}</span>}
                    </div>
                    <div className={cStyles.addField}>
                      <label>Nivel foame *</label>
                      <div className={cStyles.seg}>
                        {[{ v: 'normal', l: 'Normal' }, { v: 'crescut', l: 'Crescut' }, { v: 'extrem', l: 'Extrem' }].map(({ v, l }) => (
                          <button key={v} type="button"
                            className={`${cStyles.segBtn} ${progressData.hungerLevel === v ? cStyles.segOn : ''}`}
                            onClick={() => { setProgressData(p => ({ ...p, hungerLevel: v })); setProgressErrors(e => ({ ...e, hungerLevel: undefined })); }}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {progressErrors.hungerLevel && <span className={cStyles.addFieldError}>{progressErrors.hungerLevel}</span>}
                    </div>
                  </div>

                  {/* Secțiunea 03 — Mesaj nutriție */}
                  <div className={cStyles.addSection}>
                    <div className={cStyles.addSectionHeader}>
                      <span className={cStyles.addSectionNum}>03</span>
                      <span className={cStyles.addSectionTitle}>Mesaj nutriție</span>
                    </div>
                    <div className={`${cStyles.addField} ${cStyles.addFieldGrow}`}>
                      <label>Observații <span className={cStyles.opt}>(opțional)</span></label>
                      <textarea
                        name="notes"
                        value={progressData.notes}
                        onChange={handleProgressChange}
                        placeholder="Cum a decurs săptămâna cu mâncarea? Ce a mers bine sau ce a fost dificil..."
                      />
                    </div>
                  </div>

                </div>

                {/* Footer pas 1 */}
                <div className={cStyles.addFooter}>
                  <button type="button" className={cStyles.cancelBtn} onClick={closeProgress}>Anulează</button>
                  <button type="button" className={cStyles.saveBtn} onClick={() => {
                    if (validateStep1()) { setProgressErrors({}); setProgressStep(2); }
                  }}>
                    Continuă
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              </>
            )}

            {/* ── Pasul 2: Antrenament ── */}
            {progressStep === 2 && (
              <>
                <div className={cStyles.addStepTriple}>

                  {/* Secțiunea 01 — Respectare & Efort */}
                  <div className={cStyles.addSection}>
                    <div className={cStyles.addSectionHeader}>
                      <span className={cStyles.addSectionNum}>01</span>
                      <span className={cStyles.addSectionTitle}>Respectare & Efort</span>
                    </div>
                    <div className={cStyles.addField}>
                      <label>Ai respectat planul de antrenament? *</label>
                      <div className={cStyles.seg}>
                        {[{ v: 'complet', l: 'Complet' }, { v: 'partial', l: 'Parțial' }, { v: 'deloc', l: 'Deloc' }].map(({ v, l }) => (
                          <button key={v} type="button"
                            className={`${cStyles.segBtn} ${progressData.workoutAdherence === v ? cStyles.segOn : ''}`}
                            onClick={() => { setProgressData(p => ({ ...p, workoutAdherence: v })); setProgressErrors(e => ({ ...e, workoutAdherence: undefined })); }}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {progressErrors.workoutAdherence && <span className={cStyles.addFieldError}>{progressErrors.workoutAdherence}</span>}
                    </div>
                    <div className={cStyles.addField}>
                      <label>Nivel dificultate perceput *</label>
                      <div className={cStyles.seg}>
                        {[{ v: 'usor', l: 'Uşor' }, { v: 'moderat', l: 'Moderat' }, { v: 'greu', l: 'Greu' }].map(({ v, l }) => (
                          <button key={v} type="button"
                            className={`${cStyles.segBtn} ${progressData.workoutDifficulty === v ? cStyles.segOn : ''}`}
                            onClick={() => { setProgressData(p => ({ ...p, workoutDifficulty: v })); setProgressErrors(e => ({ ...e, workoutDifficulty: undefined })); }}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {progressErrors.workoutDifficulty && <span className={cStyles.addFieldError}>{progressErrors.workoutDifficulty}</span>}
                    </div>
                  </div>

                  {/* Secțiunea 02 — Senzații în antrenament */}
                  <div className={cStyles.addSection}>
                    <div className={cStyles.addSectionHeader}>
                      <span className={cStyles.addSectionNum}>02</span>
                      <span className={cStyles.addSectionTitle}>Senzații în antrenament</span>
                    </div>
                    <div className={cStyles.addField}>
                      <label>Pompare (pump) <span className={cStyles.opt}>(opțional)</span></label>
                      <div className={cStyles.seg}>
                        {[{ v: 'slaba', l: 'Slabă' }, { v: 'buna', l: 'Bună' }, { v: 'maxima', l: 'Maximă' }].map(({ v, l }) => (
                          <button key={v} type="button"
                            className={`${cStyles.segBtn} ${progressData.pump === v ? cStyles.segOn : ''}`}
                            onClick={() => setProgressData(p => ({ ...p, pump: v }))}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={cStyles.addField}>
                      <label>Oboseală generală <span className={cStyles.opt}>(opțional)</span></label>
                      <div className={cStyles.seg}>
                        {[{ v: 'scazuta', l: 'Scăzută' }, { v: 'moderata', l: 'Moderată' }, { v: 'ridicata', l: 'Ridicată' }].map(({ v, l }) => (
                          <button key={v} type="button"
                            className={`${cStyles.segBtn} ${progressData.generalFatigue === v ? cStyles.segOn : ''}`}
                            onClick={() => setProgressData(p => ({ ...p, generalFatigue: v }))}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={cStyles.addField}>
                      <label>Febră musculară (DOMS) <span className={cStyles.opt}>(opțional)</span></label>
                      <div className={cStyles.seg}>
                        {[{ v: 'absenta', l: 'Absentă' }, { v: 'moderata', l: 'Moderată' }, { v: 'intensa', l: 'Intensă' }].map(({ v, l }) => (
                          <button key={v} type="button"
                            className={`${cStyles.segBtn} ${progressData.muscleSoreness === v ? cStyles.segOn : ''}`}
                            onClick={() => setProgressData(p => ({ ...p, muscleSoreness: v }))}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Secțiunea 03 — Note */}
                  <div className={cStyles.addSection}>
                    <div className={cStyles.addSectionHeader}>
                      <span className={cStyles.addSectionNum}>03</span>
                      <span className={cStyles.addSectionTitle}>Note</span>
                    </div>
                    <div className={`${cStyles.addField} ${cStyles.addFieldGrow}`}>
                      <label>Observații antrenament <span className={cStyles.opt}>(opțional)</span></label>
                      <textarea
                        name="workoutNotes"
                        value={progressData.workoutNotes}
                        onChange={handleProgressChange}
                        placeholder="Ce exerciții au mers bine? Unde ai simțit progres sau dificultăți?"
                      />
                    </div>
                  </div>

                </div>

                {/* Footer pas 2 */}
                <div className={cStyles.addFooter}>
                  {progressSubmitError && (
                    <span style={{ fontSize: 12, color: '#e05252' }}>{progressSubmitError}</span>
                  )}
                  <button type="button" className={cStyles.cancelBtn} onClick={() => { setProgressStep(1); setProgressErrors({}); }} disabled={progressSubmitting}>
                    Înapoi
                  </button>
                  <button type="button" className={cStyles.saveBtn} onClick={handleProgressSubmit} disabled={progressSubmitting}>
                    {progressSubmitting ? 'Se trimite...' : 'Trimite progresul'}
                  </button>
                </div>
              </>
            )}

          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.mealPageHeader}>
        {onBack && (
          <button className={styles.mealBackBtn} onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Înapoi
          </button>
        )}
        <h1 className={styles.mealTodayTitle}>{dayNames[activeDay % dayNames.length]}</h1>
        {dayCaloriesTotal > 0 && (
          <div
            className={styles.mealKcalProgress}
            aria-label={`${dayCaloriesConsumed} din ${dayCaloriesTotal} kcal consumate`}
          >
            <div className={styles.mealKcalRing}>
              <svg className={styles.mealKcalRingSvg} viewBox="0 0 52 52" aria-hidden="true">
                <circle className={styles.mealKcalRingTrack} cx="26" cy="26" r="22" pathLength="100" />
                <circle
                  className={styles.mealKcalRingValue}
                  cx="26"
                  cy="26"
                  r="22"
                  pathLength="100"
                  style={{ strokeDashoffset: 100 - dayCaloriesProgress }}
                />
              </svg>
              <div className={styles.mealKcalRingInner}>
                <span>{dayCaloriesProgress}%</span>
              </div>
            </div>
            <div className={styles.mealKcalText}>
              <span className={styles.mealKcalLabel}>Calorii consumate</span>
              <strong key={`${activeDay}-${dayCaloriesConsumed}`}>{dayCaloriesConsumed} / {dayCaloriesTotal}</strong>
              <span className={styles.mealKcalTotal}>kcal astăzi</span>
            </div>
          </div>
        )}
      </div>

      {/* Banner progres trimis */}
      {progressSentBanner && (
        <div className={styles.progressSentBanner}>
          <span className={styles.progressSentIcon}>✓</span>
          <span>{progressSentBanner}</span>
          <button className={styles.progressSentClose} onClick={() => setProgressSentBanner(null)}>✕</button>
        </div>
      )}

      {/* Left Column - Client Info */}
      <div className={styles.leftColumn}>
        <div className={styles.clientSummary}>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryItem}>
              <span className={styles.label}>Client</span>
              <span className={styles.value}>{clientData.name}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.label}>Vârstă</span>
              <span className={styles.value}>{clientData.age} ani</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.label}>Obiectiv</span>
              <span className={styles.value}>{goalLabels[clientData.goal]}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.label}>Dietă</span>
              <span className={styles.value}>{dietLabels[clientData.dietType]}</span>
            </div>
          </div>

          {nutritionalNeeds && (
            <div className={styles.macroTargets}>
              <h4 className={styles.macroTargetsTitle}>Necesar zilnic</h4>
              <div className={styles.macroGrid}>
                <div className={styles.macroItem}>
                  <span className={styles.macroValue}>{nutritionalNeeds.calories}</span>
                  <span className={styles.macroLabel}>kcal</span>
                </div>
                <div className={styles.macroItem}>
                  <span className={styles.macroValue}>{nutritionalNeeds.protein}g</span>
                  <span className={styles.macroLabel}>Proteine</span>
                </div>
                <div className={styles.macroItem}>
                  <span className={styles.macroValue}>{nutritionalNeeds.carbs}g</span>
                  <span className={styles.macroLabel}>Carbo</span>
                </div>
                <div className={styles.macroItem}>
                  <span className={styles.macroValue}>{nutritionalNeeds.fat}g</span>
                  <span className={styles.macroLabel}>Grăsimi</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Daily Totals in Left Column */}
        {currentDay.dailyTotals && (
          <div className={styles.dailyTotals}>
            <h4>Total {dayNames[activeDay]}</h4>
            <div className={styles.macroGrid}>
              <div className={styles.macroItem}>
                <span className={styles.macroValue}>{currentDay.dailyTotals.calories}</span>
                <span className={styles.macroLabel}>kcal</span>
              </div>
              <div className={styles.macroItem}>
                <span className={styles.macroValue}>{currentDay.dailyTotals.protein}g</span>
                <span className={styles.macroLabel}>Proteine</span>
              </div>
              <div className={styles.macroItem}>
                <span className={styles.macroValue}>{currentDay.dailyTotals.carbs}g</span>
                <span className={styles.macroLabel}>Carbo</span>
              </div>
              <div className={styles.macroItem}>
                <span className={styles.macroValue}>{currentDay.dailyTotals.fat}g</span>
                <span className={styles.macroLabel}>Grăsimi</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Column - Meals */}
      <div className={styles.rightColumn}>
        {/* Day Tabs + Download */}
        <div className={styles.tabsRow}>
          <div className={styles.dayTabs}>
            {plan.days.map((day, index) => {
              const isCompleted = dayStatus[String(index)] === true;
              const dayState = getMealDayState(index);
              const isCurrentDay = index === safeCurrentPlanDay && safeCurrentPlanDay < 7;
              const isReadOnlyTab = !isCurrentDay || dayState.disabled;
              return (
              <button
                key={index}
                className={`${styles.dayTab} ${activeDay === index ? styles.dayTabActive : ''} ${isReadOnlyTab ? styles.dayTabReadOnly : ''} ${isCurrentDay && !dayState.disabled ? styles.dayTabCurrent : ''}`}
                onClick={() => setActiveDay(index)}
                aria-disabled={isReadOnlyTab}
                title={isReadOnlyTab ? 'Doar consultare' : 'Zi activă'}
              >
                  <span className={styles.dayTabInner}>
                    <span className={styles.dayFull}>{dayNames[index % dayNames.length]}</span>
                    <span className={styles.dayShort}>{dayNamesShort[index % dayNamesShort.length]}</span>
                    {isCompleted && (
                      <svg className={styles.dayTabLockIcon} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                </span>
              </button>
              );
            })}
          </div>
        </div>

        {/* Meals */}
        {(() => {
          const isDayLocked = lockedAfterDay !== null && activeDay > lockedAfterDay;
          void isDayLocked;
          return (
            <div>
              {/* Meals Grid for Active Day */}
              <div className={`${styles.mealsGrid} ${isReadOnlyDay ? styles.mealsGridReadOnly : ''}`}>
                {currentDay.meals.map((meal, mealIndex) => {
            const { name } = getMealLabel(meal.mealType);
            const mealChecked = isMealChecked(activeDay, mealIndex);
            const mealImageUrl = getMealImageUrl(meal);
            const mealImageFallbackUrl = getMealImageFallbackUrl(meal);
            return (
              <div key={mealIndex} className={styles.mealCard}>
                <div className={styles.mealCardHeader}>
                  <div className={styles.mealCardHeaderText}>
                    <span className={styles.mealTypeLabel}>{name}</span>
                    <h4>{meal.name || name}</h4>
                  </div>
                  <div className={styles.mealHeaderActions}>
                    {onFinishMeals && (
                      <button
                        type="button"
                        className={`${styles.mealCheckBtn} ${mealChecked ? styles.mealCheckBtnChecked : ''} ${isReadOnlyDay ? styles.mealCheckBtnReadOnly : ''}`}
                        onClick={() => {
                          if (!isReadOnlyDay) handleMealCheckToggle(mealIndex);
                        }}
                        disabled={isReadOnlyDay || activeMealDayState.disabled}
                        aria-label={mealChecked ? `${name} bifată` : `Bifează ${name}`}
                        title={isReadOnlyDay ? 'Zi blocată' : mealChecked ? 'Masă bifată' : 'Bifează masa'}
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>{mealChecked ? 'Mâncat' : isReadOnlyDay ? 'Nemâncat' : 'Bifează masa'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {mealImageUrl && (
                  <div className={`${styles.mealImageWrap} ${loadedMealImages[mealImageUrl] ? styles.mealImageWrapReady : styles.mealImageWrapLoading}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className={styles.mealImage}
                      src={mealImageUrl}
                      alt={meal.name || name}
                      width="900"
                      height="506"
                      loading={activeDay === safeCurrentPlanDay && mealIndex === 0 ? 'eager' : 'lazy'}
                      fetchPriority={activeDay === safeCurrentPlanDay && mealIndex === 0 ? 'high' : 'auto'}
                      decoding="async"
                      onLoad={() => {
                        setLoadedMealImages(prev => prev[mealImageUrl] ? prev : { ...prev, [mealImageUrl]: true });
                      }}
                      onError={(event) => {
                        if (mealImageFallbackUrl && event.currentTarget.src !== mealImageFallbackUrl) {
                          event.currentTarget.src = mealImageFallbackUrl;
                          return;
                        }
                        setLoadedMealImages(prev => prev[mealImageUrl] ? prev : { ...prev, [mealImageUrl]: true });
                      }}
                    />
                  </div>
                )}

                <ul className={styles.mealList}>
                  {meal.foods.map((food, foodIndex) => (
                    <li key={foodIndex} className={styles.mealItem}>
                      <div className={styles.foodMainRow}>
                        <span className={styles.foodName}>{food.name}</span>
                        {canEditAmountsForDay ? (
                          <div className={styles.amountStepper} aria-label={`Gramaj ${food.name}`}>
                            <button
                              type="button"
                              className={styles.amountStepBtn}
                              onClick={() => handleFoodAmountChange(mealIndex, foodIndex, (Number(food.amount) || 5) - 5)}
                              disabled={(Number(food.amount) || 0) <= 5}
                              aria-label={`Scade gramajul pentru ${food.name}`}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="5"
                              step="5"
                              className={styles.amountInput}
                              value={food.amount ?? 5}
                              onChange={(event) => handleFoodAmountChange(mealIndex, foodIndex, event.target.value)}
                              aria-label={`Gramaj ${food.name}`}
                            />
                            <span className={styles.amountUnit}>{food.unit || 'g'}</span>
                            <button
                              type="button"
                              className={styles.amountStepBtn}
                              onClick={() => handleFoodAmountChange(mealIndex, foodIndex, (Number(food.amount) || 5) + 5)}
                              aria-label={`Crește gramajul pentru ${food.name}`}
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <span className={styles.foodAmount}>
                            {food.displayAmount || `${food.amount}${food.unit}`}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>

                {meal.preparation && (
                  <div className={styles.preparation}>
                    {meal.preparation}
                  </div>
                )}

                {meal.mealTotals && (
                  <div className={styles.mealTotals}>
                    <span>Total masă</span>
                    <strong>{meal.mealTotals.calories} kcal</strong>
                  </div>
                )}
              </div>
            );
          })}
              </div>
              {canFinalizeMealsDay && (
                <div className={styles.finishMealsWrap}>
                  <button
                    type="button"
                    className={styles.finishMealsBtn}
                    onClick={() => onFinishMeals(activeDay)}
                  >
                    Finalizează ziua!
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Modal Progres */}
      {showProgress && (
        <div className={styles.modalOverlay} onClick={() => setShowProgress(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>{onSubmitProgress ? 'Trimite actualizare progres' : 'Actualizare progres client'}</h3>
              <button className={styles.modalClose} onClick={() => setShowProgress(false)} disabled={progressSubmitting}>✕</button>
            </div>

            <div className={styles.modalBody}>
              {/* Afișează obiectivul curent */}
              {clientData?.goal && (
                <div className={styles.modalGoalInfo}>
                  <span className={styles.modalGoalLabel}>Obiectiv curent:</span>
                  <span className={styles.modalGoalValue}>{goalLabels[clientData.goal] || clientData.goal}</span>
                </div>
              )}

              <div className={styles.modalField}>
                <label>Greutate curentă (kg) *</label>
                <input
                  type="number"
                  name="currentWeight"
                  value={progressData.currentWeight}
                  onChange={handleProgressChange}
                  step="0.1" min="30" max="300"
                  placeholder="ex: 73.5"
                  className={progressErrors.currentWeight ? styles.inputError : ''}
                />
                {progressErrors.currentWeight && (
                  <span className={styles.fieldError}>{progressErrors.currentWeight}</span>
                )}
                {!progressErrors.currentWeight && clientData?.weight && progressData.currentWeight && (
                  <span className={styles.weightDiff}>
                    Diferență: {(parseFloat(progressData.currentWeight) - parseFloat(clientData.weight)).toFixed(1)} kg
                  </span>
                )}
              </div>

              <div className={styles.modalRow}>
                <div className={styles.modalField}>
                  <label>Respectare plan *</label>
                  <select name="adherence" value={progressData.adherence} onChange={handleProgressChange}
                    className={progressErrors.adherence ? styles.inputError : ''}>
                    <option value="">Selectează</option>
                    <option value="complet">Complet</option>
                    <option value="partial">Parțial</option>
                    <option value="deloc">Deloc</option>
                  </select>
                  {progressErrors.adherence && (
                    <span className={styles.fieldError}>{progressErrors.adherence}</span>
                  )}
                </div>

                <div className={styles.modalField}>
                  <label>Nivel energie *</label>
                  <select name="energyLevel" value={progressData.energyLevel} onChange={handleProgressChange}
                    className={progressErrors.energyLevel ? styles.inputError : ''}>
                    <option value="">Selectează</option>
                    <option value="scazut">Scăzut</option>
                    <option value="normal">Normal</option>
                    <option value="ridicat">Ridicat</option>
                  </select>
                  {progressErrors.energyLevel && (
                    <span className={styles.fieldError}>{progressErrors.energyLevel}</span>
                  )}
                </div>
              </div>

              <div className={styles.modalRow}>
                <div className={styles.modalField}>
                  <label>Nivel foame *</label>
                  <select name="hungerLevel" value={progressData.hungerLevel} onChange={handleProgressChange}
                    className={progressErrors.hungerLevel ? styles.inputError : ''}>
                    <option value="">Selectează</option>
                    <option value="normal">Normal</option>
                    <option value="crescut">Crescut (foame constantă)</option>
                    <option value="extrem">Extrem (foame + oboseală)</option>
                  </select>
                  {progressErrors.hungerLevel && (
                    <span className={styles.fieldError}>{progressErrors.hungerLevel}</span>
                  )}
                </div>
              </div>

              {/* Afișare istoric greutate (ultimele înregistrări) */}
              {weightHistory.length > 0 && (
                <div className={styles.weightHistoryPreview}>
                  <label>Istoric greutate (ultimele {Math.min(weightHistory.length, 5)} înregistrări)</label>
                  <div className={styles.weightHistoryList}>
                    {weightHistory.slice(0, 5).map((entry, idx) => (
                      <div key={entry.id || idx} className={styles.weightHistoryItem}>
                        <span className={styles.weightHistoryDate}>
                          {new Date(entry.recorded_at).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })}
                        </span>
                        <span className={styles.weightHistoryValue}>{entry.weight} kg</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.modalField}>
                <label>{onSubmitProgress ? 'Mesaj pentru antrenor (opțional)' : 'Observații antrenor (opțional)'}</label>
                <textarea
                  name="notes"
                  value={progressData.notes}
                  onChange={handleProgressChange}
                  placeholder="Notează observații relevante pentru noul plan..."
                  rows="3"
                />
              </div>
            </div>

            {progressSubmitError && (
              <div className={styles.fieldError} style={{ padding: '0 20px 8px' }}>
                {progressSubmitError}
              </div>
            )}
            <div className={styles.modalFooter}>
              <button className={styles.modalCancelBtn} onClick={() => setShowProgress(false)} disabled={progressSubmitting}>
                Anulează
              </button>
              <button
                className={styles.modalSubmitBtn}
                onClick={handleProgressSubmit}
                disabled={progressSubmitting}
              >
                {progressSubmitting ? (
                  'Se trimite...'
                ) : onSubmitProgress ? (
                  'Trimite progresul'
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                      <path d="M3 3v5h5"/>
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                      <path d="M16 16h5v5"/>
                    </svg>
                    Regenerează plan
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
