'use client';

import { useState } from 'react';
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

// ─── Main WorkoutPlan component ───────────────────────────────────────────────
export default function WorkoutPlan({ plan, clientData, onViewProgress, onSubmitProgress, progressCooldownUntil }) {
  const { user } = useAuth();
  const [activeDay, setActiveDay] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);

  const cooldownDate = progressCooldownUntil ? new Date(progressCooldownUntil) : null;
  const progressInCooldown = !!(cooldownDate && cooldownDate > new Date());
  const progressDaysLeft = progressInCooldown
    ? Math.ceil((cooldownDate - new Date()) / (1000 * 60 * 60 * 24))
    : 0;

  if (!plan || !plan.days || plan.days.length === 0) {
    return <div className={styles.container}>Nu s-a putut genera planul.</div>;
  }

  // În UI afișăm doar zilele de antrenament (nu și zilele de odihnă).
  const workoutOnlyDays = plan.days.filter(day => !day.isRestDay);
  const visibleDays = workoutOnlyDays.length > 0 ? workoutOnlyDays : plan.days;
  const currentDay = visibleDays[activeDay] || visibleDays[0] || {};
  const currentDayName = currentDay.dayName
    || (typeof currentDay.day === 'number' ? DAY_NAMES_FULL[currentDay.day - 1] : null)
    || DAY_NAMES_FULL[activeDay]
    || 'Ziua selectată';
  const exerciseCount = (currentDay.exercises || []).length;
  const totalSets = (currentDay.exercises || []).reduce((sum, exercise) => sum + (Number(exercise.sets) || 0), 0);
  const totalRestSeconds = (currentDay.exercises || []).reduce((sum, exercise) => sum + (Number(exercise.restSeconds) || 0), 0);
  const averageRestSeconds = exerciseCount > 0 ? Math.round(totalRestSeconds / exerciseCount) : 0;
  const activityLabels = {
    sedentary: 'Sedentară',
    light: 'Ușor activă',
    lightly_active: 'Ușor activă',
    moderate: 'Moderată',
    moderately_active: 'Moderată',
    active: 'Activă',
    very_active: 'Foarte activă',
    extra_active: 'Extrem de activă',
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
              {FITNESS_GOAL_LABELS[plan.fitnessGoal] || plan.fitnessGoal || 'Plan antrenament'} · {clientData?.training_split || plan.split || 'Split personalizat'}
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
          {clientData?.activity_level && (
            <div className={mealStyles.clientStat}>
              <span className={mealStyles.clientStatValue}>{activityLabels[clientData.activity_level] || clientData.activity_level}</span>
              <span className={mealStyles.clientStatLabel}>activitate</span>
            </div>
          )}
        </div>
      </div>

      <div className={mealStyles.rightColumn}>
        <div className={mealStyles.tabsRow}>
          <div className={mealStyles.dayTabs}>
            {visibleDays.map((day, i) => {
              const fullDayName = day.dayName
                || (typeof day.day === 'number' ? DAY_NAMES_FULL[day.day - 1] : null)
                || DAY_NAMES_FULL[i];
              const shortDayName = DAY_SHORT_BY_NAME[fullDayName] || DAY_NAMES_SHORT[i] || fullDayName;
              return (
              <button
                key={i}
                className={`${mealStyles.dayTab} ${i === activeDay ? mealStyles.dayTabActive : ''}`}
                onClick={() => setActiveDay(i)}
              >
                <span className={mealStyles.dayFull}>{fullDayName}</span>
                <span className={mealStyles.dayShort}>{shortDayName}</span>
              </button>
            );
            })}
          </div>
          <div className={mealStyles.tabsActions}>
            {onSubmitProgress && (
              <button
                className={`${mealStyles.updateProgressBtn} ${progressInCooldown ? mealStyles.updateProgressBtnLocked : ''}`}
                onClick={() => { if (!progressInCooldown) onSubmitProgress(); }}
                disabled={progressInCooldown}
                title={progressInCooldown ? `Disponibil în ${progressDaysLeft} ${progressDaysLeft === 1 ? 'zi' : 'zile'}` : undefined}
              >
                {progressInCooldown ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    {`Disponibil în ${progressDaysLeft} ${progressDaysLeft === 1 ? 'zi' : 'zile'}`}
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
            )}
            {onViewProgress && (
              <button
                className={mealStyles.updateProgressBtn}
                onClick={() => onViewProgress()}
                title="Vizualizează progresul trimis de client"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                Vizualizează progres
              </button>
            )}
            <button
              className={`${mealStyles.downloadBtn} ${pdfLoading ? mealStyles.downloadBtnLoading : ''}`}
              onClick={handleDownload}
              disabled={pdfLoading}
              title="Descarcă plan PDF"
            >
              {pdfLoading ? (
                <>
                  <span className={mealStyles.pdfSpinner} />
                  <span className={mealStyles.downloadBtnLabel}>Se generează...</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  <span className={mealStyles.downloadBtnLabel}>PDF</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className={mealStyles.dayTotalsBar}>
          <span className={mealStyles.dayTotalsLabel}>
            {currentDayName} · {currentDay.sessionName || 'Antrenament'}
          </span>
          <div className={mealStyles.dayTotalsValues}>
            <span><strong>{exerciseCount}</strong> exerciții</span>
            <span className={mealStyles.dotLight}>·</span>
            <span><strong>{totalSets}</strong> serii totale</span>
            <span className={mealStyles.dotLight}>·</span>
            <span><strong>{currentDay.estimatedDuration || 0}</strong> min</span>
            <span className={mealStyles.dotLight}>·</span>
            <span><strong>{averageRestSeconds}</strong> sec pauză medie</span>
          </div>
        </div>

        {currentDay.isRestDay ? (
          <div className={styles.restDayWrapper}>
            <div className={mealStyles.mealCard}>
              <div className={mealStyles.mealCardHeader}>
                <div className={mealStyles.mealCardHeaderText}>
                  <p className={mealStyles.mealTypeLabel}>Recuperare</p>
                  <h4>Zi de odihnă</h4>
                  <p className={mealStyles.mealSubtitle}>{currentDay.message || 'Recuperare activă recomandată — mers, mobilitate, hidratare.'}</p>
                </div>
              </div>
              <div className={styles.restTips}>
                <span>Hidratare</span>
                <span>Mobilitate</span>
                <span>Somn</span>
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
                  <span>Seturi: {exercise.sets || 3}</span>
                  <span>Repetări: {exercise.reps || '8-12'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
