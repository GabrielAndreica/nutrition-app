'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/app/contexts/AuthContext';
import mealStyles from '@/app/components/MealPlanGenerator/meal-plan.module.css';
import styles from './workout-plan.module.css';

// Dynamic import for PDF (uses jsPDF)
const generateWorkoutPDFModule = () => import('./generateWorkoutPDF');

const DAY_NAMES_SHORT = ['Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ', 'Du'];
const DAY_NAMES_FULL = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
const DAY_SHORT_BY_NAME = {
  'Luni': 'Lu',
  'Marți': 'Ma',
  'Miercuri': 'Mi',
  'Joi': 'Jo',
  'Vineri': 'Vi',
  'Sâmbătă': 'Sâ',
  'Duminică': 'Du',
};

const FITNESS_GOAL_LABELS = {
  'muscle gain':  'Masă musculară',
  'weight loss':  'Slăbit',
  'maintenance':  'Menținere',
  'strength':     'Forță',
  'endurance':    'Rezistență',
};

const FITNESS_LEVEL_LABELS = {
  beginner:     'Începător',
  intermediate: 'Intermediar',
  advanced:     'Avansat',
};

const EQUIPMENT_LABELS = {
  'no equipment':  'Fără echipament',
  'dumbbells only': 'Gantere',
  'full gym':      'Sală completă',
};

const TRAINING_SPLIT_LABELS = {
  'Push/Pull/Legs': 'PPL',
  'Upper/Lower/Push/Pull/Legs': 'ULPPL',
};

// ─── Main WorkoutPlan component ───────────────────────────────────────────────
export default function WorkoutPlan({
  plan,
  clientData,
  onViewProgress,
  onSubmitProgress,
  progressCooldownUntil,
  hideReviewActions = false,
  editableSets = false,
  onPlanChange,
  onPlanDirtyChange,
  lockedAfterDay = null,
  currentPlanDay = 0,
  dayStatus = {},
  onFinishWorkout,
}) {
  const { user } = useAuth();
  const [activeDay, setActiveDay] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const safeCurrentPlanDay = Math.max(0, Math.min(7, Number(currentPlanDay) || 0));

  const cooldownDate = progressCooldownUntil ? new Date(progressCooldownUntil) : null;
  const progressInCooldown = !!(cooldownDate && cooldownDate > new Date());
  const progressDaysLeft = progressInCooldown
    ? Math.ceil((cooldownDate - new Date()) / (1000 * 60 * 60 * 24))
    : 0;

  useEffect(() => {
    if (!onFinishWorkout) return;
    setActiveDay(Math.min(safeCurrentPlanDay, 6));
  }, [onFinishWorkout, safeCurrentPlanDay]);

  if (!plan || !plan.days || plan.days.length === 0) {
    return <div className={styles.container}>Nu s-a putut genera planul.</div>;
  }

  // Construim întotdeauna 7 zile: zilele de antrenament + zile de recuperare ca filler.
  const workoutOnlyDayEntries = plan.days
    .map((day, dayIndex) => ({ day, dayIndex }))
    .filter(({ day }) => !day.isRestDay);
  const TOTAL_WEEK_DAYS = 7;
  const visibleDayEntries = Array.from({ length: TOTAL_WEEK_DAYS }, (_, i) => {
    if (i < workoutOnlyDayEntries.length) return workoutOnlyDayEntries[i];
    return {
      day: {
        isRestDay: true,
        dayName: DAY_NAMES_FULL[i],
        message: 'Zi de recuperare — mers ușor, mobilitate, hidratare și somn de calitate.',
      },
      dayIndex: -1,
    };
  });
  const visibleDays = visibleDayEntries.map(({ day }) => day);
  const currentDayEntry = visibleDayEntries[activeDay] || visibleDayEntries[0] || { day: {}, dayIndex: 0 };
  const currentDay = currentDayEntry.day || {};
  const isCurrentDayRecovery = currentDay.isRestDay === true;
  const currentDayName = currentDay.dayName
    || (typeof currentDay.day === 'number' ? DAY_NAMES_FULL[currentDay.day - 1] : null)
    || DAY_NAMES_FULL[activeDay]
    || 'Ziua selectată';
  const exerciseCount = (currentDay.exercises || []).length;
  const totalSets = (currentDay.exercises || []).reduce((sum, exercise) => sum + (Number(exercise.sets) || 0), 0);
  const splitLabel = TRAINING_SPLIT_LABELS[clientData?.training_split || plan.split]
    || clientData?.training_split
    || plan.split
    || 'Split personalizat';
  const canEditSets = editableSets && user?.role === 'trainer' && typeof onPlanChange === 'function';

  const changeExerciseSets = (exerciseIndex, rawValue) => {
    const nextSets = Math.max(1, Math.min(12, Number.parseInt(rawValue, 10) || 1));
    const nextPlan = JSON.parse(JSON.stringify(plan));
    const exercise = nextPlan.days?.[currentDayEntry.dayIndex]?.exercises?.[exerciseIndex];
    if (!exercise) return;
    exercise.sets = nextSets;
    onPlanChange(nextPlan);
    onPlanDirtyChange?.(true);
  };

  const stepExerciseSets = (exerciseIndex, delta) => {
    const currentSets = Number(currentDay.exercises?.[exerciseIndex]?.sets) || 3;
    changeExerciseSets(exerciseIndex, currentSets + delta);
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
          body: JSON.stringify({ clientId, reason: 'workout_plan_pdf_export' }),
        });
        const usageData = await usageRes.json().catch(() => ({}));
        if (!usageRes.ok) {
          alert(usageData.error || 'Nu am putut exporta PDF-ul din cauza limitei de clienți.');
          return;
        }
      }

      const { generateWorkoutPlanPDF } = await generateWorkoutPDFModule();
      generateWorkoutPlanPDF(plan, clientData);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className={mealStyles.container}>
      <div className={mealStyles.clientHeader}>
        <div className={mealStyles.clientHeaderLeft}>
          <div>
            <h2 className={mealStyles.clientName}>{clientData?.name || plan.clientName}</h2>
            <p className={mealStyles.clientSub}>
              {FITNESS_GOAL_LABELS[plan.fitnessGoal] || plan.fitnessGoal || 'Plan antrenament'} · {splitLabel}
            </p>
          </div>
        </div>
        <div className={mealStyles.clientStats}>
          {clientData?.age && (
            <div className={mealStyles.clientStat}>
              <span className={mealStyles.clientStatValue}>{clientData.age}</span>
              <span className={mealStyles.clientStatLabel}>Vârstă</span>
            </div>
          )}
          {clientData?.weight && (
            <div className={mealStyles.clientStat}>
              <span className={mealStyles.clientStatValue}>{clientData.weight}</span>
              <span className={mealStyles.clientStatLabel}>Greutate</span>
            </div>
          )}
          {clientData?.height && (
            <div className={mealStyles.clientStat}>
              <span className={mealStyles.clientStatValue}>{clientData.height}</span>
              <span className={mealStyles.clientStatLabel}>Înălțime</span>
            </div>
          )}
        </div>
      </div>

      <div className={mealStyles.rightColumn}>
        <div className={mealStyles.tabsRow}>
          <div className={mealStyles.dayTabs}>
            {visibleDays.map((day, i) => (
              <button
                key={i}
                className={`${mealStyles.dayTab} ${i === activeDay ? mealStyles.dayTabActive : ''}`}
                onClick={() => setActiveDay(i)}
              >
                <span className={mealStyles.dayTabInner}>
                  <span className={mealStyles.dayFull}>{`Ziua ${i + 1}`}</span>
                  <span className={mealStyles.dayShort}>{`Z${i + 1}`}</span>
                </span>
              </button>
            ))}
          </div>
          {onFinishWorkout && (
          <div className={mealStyles.tabsActions}>
            {(() => {
              const dayCompleted = dayStatus[String(activeDay)] === true;
              const dayDisabled = activeDay < safeCurrentPlanDay && !dayCompleted;
              const weekCompleted = safeCurrentPlanDay >= 7;
              const dayLocked = dayDisabled || activeDay > safeCurrentPlanDay || (lockedAfterDay !== null && activeDay > lockedAfterDay);
              const btnDisabled = progressInCooldown || dayLocked || dayCompleted || weekCompleted;
              const isDone = dayCompleted || (progressInCooldown && !dayLocked);
              const daysUntilUnlock = dayLocked ? Math.max(1, activeDay - safeCurrentPlanDay) : progressDaysLeft;
              const disabledLabel = weekCompleted
                ? 'Săptămână completă'
                : (dayDisabled
                  ? 'Dezactivat'
                  : isDone
                  ? 'Finalizat'
                  : `Disponibil în ${daysUntilUnlock} ${daysUntilUnlock === 1 ? 'zi' : 'zile'}`);
              return (
                <button
                  className={`${mealStyles.updateProgressBtn} ${btnDisabled ? (isDone ? mealStyles.updateProgressBtnDone : mealStyles.updateProgressBtnLocked) : ''}`}
                  onClick={() => { if (!btnDisabled) onFinishWorkout(activeDay, isCurrentDayRecovery); }}
                  disabled={btnDisabled}
                  title={btnDisabled ? disabledLabel : undefined}
                >
                  {btnDisabled ? (
                    isDone ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    ) : disabledLabel === 'Dezactivat' ? null : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                    )
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                  {btnDisabled ? disabledLabel : (isCurrentDayRecovery ? 'Finalizare zi' : 'Finalizare antrenament')}
                </button>
              );
            })()}
          </div>
          )}
        </div>

        {(() => {
          return (
            <div>
              <div className={mealStyles.dayTotalsBar}>
                <span className={mealStyles.dayTotalsLabel}>
                  {currentDayName} · {isCurrentDayRecovery ? 'Recuperare' : (currentDay.sessionName || 'Antrenament')}
                </span>
                {!isCurrentDayRecovery && (
                <div className={mealStyles.dayTotalsValues}>
                  <span><strong>{exerciseCount}</strong> exerciții</span>
                  <span className={mealStyles.dotLight}>·</span>
                  <span><strong>{totalSets}</strong> serii totale</span>
                  <span className={mealStyles.dotLight}>·</span>
                  <span><strong>{currentDay.estimatedDuration || 0}</strong> min</span>
                </div>
                )}
              </div>

        {currentDay.isRestDay ? (
          <div className={mealStyles.mealsGrid}>
            <div className={mealStyles.mealCard}>
              <div className={mealStyles.mealCardHeader}>
                <div className={mealStyles.mealCardHeaderText}>
                  <p className={mealStyles.mealTypeLabel}>Recuperare</p>
                  <h4>Zi de recuperare</h4>
                  <p className={mealStyles.mealSubtitle}>Lasă corpul să se refacă. Activitate ușoară și odihnă activă.</p>
                </div>
              </div>
              <div className={mealStyles.mealTotals}>
                <span>Hidratare adecvată</span>
                <span>Somn 8 ore</span>
                <span>Mers ușor</span>
              </div>
            </div>
          </div>
        ) : (
          <div className={mealStyles.mealsGrid}>
            {(currentDay.exercises || []).map((exercise, index) => (
              <div key={index} className={mealStyles.mealCard}>
                <div className={mealStyles.mealCardHeader}>
                  <div className={mealStyles.mealCardHeaderText}>
                    <p className={mealStyles.mealTypeLabel}>{exercise.muscleGroup || 'Exercițiu'}</p>
                    <h4>{exercise.name || `Exercițiul ${index + 1}`}</h4>
                    <p className={mealStyles.mealSubtitle}>
                      Pauză {exercise.restSeconds || 90}s
                    </p>
                  </div>
                  <span className={mealStyles.mealCalories}>
                    {index + 1}
                  </span>
                </div>

                <div className={mealStyles.mealTotals}>
                  {canEditSets ? (
                    <div className={styles.setsControl}>
                      <span>Seturi</span>
                      <div className={styles.setsStepper}>
                        <button
                          type="button"
                          onClick={() => stepExerciseSets(index, -1)}
                          disabled={(Number(exercise.sets) || 0) <= 1}
                          aria-label={`Scade numărul de serii pentru ${exercise.name || `exercițiul ${index + 1}`}`}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="1"
                          max="12"
                          step="1"
                          value={exercise.sets || 3}
                          onChange={(event) => changeExerciseSets(index, event.target.value)}
                          aria-label={`Număr de serii pentru ${exercise.name || `exercițiul ${index + 1}`}`}
                        />
                        <button
                          type="button"
                          onClick={() => stepExerciseSets(index, 1)}
                          aria-label={`Crește numărul de serii pentru ${exercise.name || `exercițiul ${index + 1}`}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span>Seturi: {exercise.sets || 3}</span>
                  )}
                  <span>Repetări: {exercise.reps || '8-12'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
