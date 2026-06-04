'use client';

import { useState, useRef } from 'react';
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
}) {
  const { user } = useAuth();
  const [activeDay, setActiveDay] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const touchDragRef = useRef(null);

  const canEdit = editableSets && user?.role === 'trainer' && typeof onPlanChange === 'function';

  // Strip any HTML tags injected via contentEditable and enforce max length
  const sanitizeName = (str) => String(str).replace(/<[^>]*>/g, '').trim().slice(0, 100);

  const handleTouchStart = (index) => (e) => {
    if (!canEdit) return;
    touchDragRef.current = index;
    setDragIndex(index);
    setDropIndex(index);
  };

  const handleTouchMove = (e) => {
    if (!canEdit || touchDragRef.current === null) return;
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = el?.closest('[data-exercise-index]');
    if (card) {
      const idx = Number(card.dataset.exerciseIndex);
      if (!isNaN(idx)) setDropIndex(idx);
    }
  };

  const handleTouchEnd = () => {
    if (!canEdit || touchDragRef.current === null) return;
    reorderExercises(touchDragRef.current, dropIndex ?? touchDragRef.current);
    touchDragRef.current = null;
    setDragIndex(null);
    setDropIndex(null);
  };

  const cooldownDate = progressCooldownUntil ? new Date(progressCooldownUntil) : null;
  const progressInCooldown = !!(cooldownDate && cooldownDate > new Date());
  const progressDaysLeft = progressInCooldown
    ? Math.ceil((cooldownDate - new Date()) / (1000 * 60 * 60 * 24))
    : 0;

  if (!plan || !plan.days || plan.days.length === 0) {
    return <div className={styles.container}>Nu s-a putut genera planul.</div>;
  }

  // În UI afișăm doar zilele de antrenament (nu și zilele de odihnă).
  const workoutOnlyDayEntries = plan.days
    .map((day, dayIndex) => ({ day, dayIndex }))
    .filter(({ day }) => !day.isRestDay);
  const visibleDayEntries = workoutOnlyDayEntries.length > 0
    ? workoutOnlyDayEntries
    : plan.days.map((day, dayIndex) => ({ day, dayIndex }));
  const visibleDays = visibleDayEntries.map(({ day }) => day);
  const currentDayEntry = visibleDayEntries[activeDay] || visibleDayEntries[0] || { day: {}, dayIndex: 0 };
  const currentDay = currentDayEntry.day || {};
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

  const changeExerciseSets = (exerciseIndex, rawValue) => {
    const nextSets = Math.max(1, Math.min(20, Number.parseInt(rawValue, 10) || 1));
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

  const changeExerciseProp = (exerciseIndex, prop, value) => {
    let sanitizedValue = value;
    if (prop === 'reps') sanitizedValue = String(value).slice(0, 20);
    else if (prop === 'notes') sanitizedValue = String(value).slice(0, 500);
    else if (prop === 'restSeconds') sanitizedValue = Math.max(0, Math.min(600, Number(value) || 0));
    else if (prop === 'name') sanitizedValue = sanitizeName(value);
    else if (prop === 'muscleGroup') sanitizedValue = String(value).slice(0, 50);
    const nextPlan = JSON.parse(JSON.stringify(plan));
    const exercise = nextPlan.days?.[currentDayEntry.dayIndex]?.exercises?.[exerciseIndex];
    if (!exercise) return;
    exercise[prop] = sanitizedValue;
    onPlanChange(nextPlan);
    onPlanDirtyChange?.(true);
  };

  const deleteExercise = (exerciseIndex) => {
    const nextPlan = JSON.parse(JSON.stringify(plan));
    nextPlan.days?.[currentDayEntry.dayIndex]?.exercises?.splice(exerciseIndex, 1);
    onPlanChange(nextPlan);
    onPlanDirtyChange?.(true);
  };

  const addExercise = () => {
    const nextPlan = JSON.parse(JSON.stringify(plan));
    const exercises = nextPlan.days?.[currentDayEntry.dayIndex]?.exercises;
    if (!Array.isArray(exercises)) return;
    exercises.push({ name: 'Exercițiu nou', sets: 3, reps: '10', restSeconds: 60, muscleGroup: '' });
    onPlanChange(nextPlan);
    onPlanDirtyChange?.(true);
  };

  const reorderExercises = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    const nextPlan = JSON.parse(JSON.stringify(plan));
    const exercises = nextPlan.days?.[currentDayEntry.dayIndex]?.exercises;
    if (!Array.isArray(exercises)) return;
    const [moved] = exercises.splice(fromIndex, 1);
    exercises.splice(toIndex, 0, moved);
    onPlanChange(nextPlan);
    onPlanDirtyChange?.(true);
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
          {!hideReviewActions && (
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
          )}
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
          <>
          <div className={mealStyles.mealsGrid}>
            {(currentDay.exercises || []).map((exercise, index) => (              <div
                key={index}
                className={mealStyles.mealCard}
                data-exercise-index={index}
                draggable={canEdit}
                onDragStart={canEdit ? () => { setDragIndex(index); setDropIndex(index); } : undefined}
                onDragOver={canEdit ? e => { e.preventDefault(); if (dropIndex !== index) setDropIndex(index); } : undefined}
                onDrop={canEdit ? e => { e.preventDefault(); reorderExercises(dragIndex, index); setDragIndex(null); setDropIndex(null); } : undefined}
                onDragEnd={canEdit ? () => { setDragIndex(null); setDropIndex(null); } : undefined}
                style={{
                  position: 'relative',
                  ...(canEdit && dragIndex === index ? { opacity: 0.35 } : {}),
                  ...(canEdit && dropIndex === index && dragIndex !== index ? { outline: '2px solid #b7ff00', outlineOffset: '-2px' } : {}),
                }}
              >
                {canEdit ? (
                  <div style={{ display: 'flex', alignItems: 'stretch' }}>
                    {/* Grip lateral stânga */}
                    <div
                      title="Trage pentru a schimba ordinea"
                      onTouchStart={handleTouchStart(index)}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      style={{
                        cursor: 'grab',
                        flexShrink: 0,
                        width: 36,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#f9fafb',
                        borderRight: '1px solid #f3f4f6',
                        borderRadius: '12px 0 0 12px',
                        userSelect: 'none',
                        color: '#9ca3af',
                        touchAction: 'none',
                      }}
                    >
                      <svg width="12" height="20" viewBox="0 0 12 20" fill="currentColor">
                        <circle cx="3" cy="4" r="1.5"/><circle cx="9" cy="4" r="1.5"/>
                        <circle cx="3" cy="10" r="1.5"/><circle cx="9" cy="10" r="1.5"/>
                        <circle cx="3" cy="16" r="1.5"/><circle cx="9" cy="16" r="1.5"/>
                      </svg>
                    </div>
                    {/* Conținut card */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className={mealStyles.mealCardHeader}>
                        <div className={mealStyles.mealCardHeaderText}>
                          <p className={mealStyles.mealTypeLabel}>{exercise.muscleGroup || 'Exercițiu'}</p>
                          <h4
                            contentEditable
                            suppressContentEditableWarning
                            onBlur={e => {
                              const val = sanitizeName(e.currentTarget.textContent);
                              if (val !== (exercise.name || '')) changeExerciseProp(index, 'name', val || exercise.name);
                            }}
                            style={{ outline: 'none', cursor: 'text', borderBottom: '1px dashed #d1d5db', minWidth: 40 }}
                          >
                            {exercise.name || `Exercițiul ${index + 1}`}
                          </h4>
                          <textarea
                            value={exercise.notes || ''}
                            onChange={e => changeExerciseProp(index, 'notes', e.target.value)}
                            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
                            placeholder="Notițe exercițiu (opțional)..."
                            maxLength={500}
                            rows={1}
                            style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '2px 0', background: 'transparent', border: 'none', outline: 'none', resize: 'none', overflow: 'hidden', fontSize: 12, color: '#6b7280', fontStyle: 'italic', fontFamily: 'inherit', lineHeight: 1.5 }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteExercise(index)}
                          aria-label="Șterge exercițiu"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 16, lineHeight: 1, padding: '0 0 0 8px', flexShrink: 0, alignSelf: 'flex-start' }}
                        >✕</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={mealStyles.mealCardHeader}>
                    <div className={mealStyles.mealCardHeaderText}>
                      <p className={mealStyles.mealTypeLabel}>{exercise.muscleGroup || 'Exercițiu'}</p>
                      <h4>{exercise.name || `Exercițiul ${index + 1}`}</h4>
                      {exercise.notes ? (
                        <p className={mealStyles.mealSubtitle}>{exercise.notes}</p>
                      ) : (
                        <p className={mealStyles.mealSubtitle}>Pauză {exercise.restSeconds || 90}s</p>
                      )}
                    </div>
                    <span className={mealStyles.mealCalories}>{index + 1}</span>
                  </div>
                )}
                <div className={mealStyles.mealTotals}>
                  {canEdit ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      Seturi: 
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={exercise.sets || 3}
                        onChange={e => changeExerciseSets(index, e.target.value)}
                        style={{ width: 36, background: 'transparent', border: 'none', borderBottom: '1px solid #d1d5db', outline: 'none', fontSize: 'inherit', color: 'inherit', textAlign: 'center', padding: '0 2px', MozAppearance: 'textfield' }}
                      />
                    </span>
                  ) : (
                    <span>Seturi: {exercise.sets || 3}</span>
                  )}
                  {canEdit ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      Repetări: 
                      <input
                        value={exercise.reps || ''}
                        onChange={e => changeExerciseProp(index, 'reps', e.target.value)}
                        placeholder="ex: 8-12"
                        maxLength={20}
                        style={{ width: 52, background: 'transparent', border: 'none', borderBottom: '1px solid #d1d5db', outline: 'none', fontSize: 'inherit', color: 'inherit', textAlign: 'center', padding: '0 2px' }}
                      />
                    </span>
                  ) : (
                    <span>Repetări: {exercise.reps || '8-12'}</span>
                  )}
                  {canEdit ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      Pauză: 
                      <input
                        type="number"
                        min="0"
                        step="15"
                        value={exercise.restSeconds ?? 90}
                        onChange={e => changeExerciseProp(index, 'restSeconds', Math.max(0, Math.min(600, Number(e.target.value) || 0)))}
                        style={{ width: 44, background: 'transparent', border: 'none', borderBottom: '1px solid #d1d5db', outline: 'none', fontSize: 'inherit', color: 'inherit', textAlign: 'center', padding: '0 2px', MozAppearance: 'textfield' }}
                      />
                      s
                    </span>
                  ) : (
                    <span>Pauză: {exercise.restSeconds || 90}s</span>
                  )}
                </div>
              </div>
            ))}
            {canEdit && (
              <button
                type="button"
                onClick={addExercise}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '20px 16px',
                  background: 'transparent',
                  border: '2px dashed #e5e7eb',
                  borderRadius: 12,
                  cursor: 'pointer',
                  color: '#9ca3af',
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  transition: 'border-color 0.15s, color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#b7ff00'; e.currentTarget.style.color = '#374151'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.color = '#9ca3af'; }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                Adaugă exercițiu
              </button>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
