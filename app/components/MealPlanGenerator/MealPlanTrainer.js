'use client';

import { useState } from 'react';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './meal-plan.module.css';

const clonePlan = (value) => JSON.parse(JSON.stringify(value || {}));
const roundMacro = (value) => Math.round((Number(value) || 0) * 10) / 10;
const roundKcal = (value) => Math.round(Number(value) || 0);

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

export default function MealPlanTrainer({
  plan,
  clientData,
  nutritionalNeeds,
  onReset,
  onRegenerate,
  onViewProgress,
  editableAmounts = false,
  onPlanChange,
  onPlanDirtyChange,
  hideReviewActions = false,
}) {
  const { user } = useAuth();
  const [activeDay, setActiveDay] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);

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
    'Breakfast': { name: 'Masa 1' },
    'Lunch': { name: 'Masa 2' },
    'Dinner': { name: 'Masa 3' },
    'Snack': { name: 'Gustare' },
    'Snack 1': { name: 'Gustare 1' },
    'Snack 2': { name: 'Gustare 2' },
    'Mic Dejun': { name: 'Masa 1' },
    'Prânz': { name: 'Masa 2' },
    'Cină': { name: 'Masa 3' },
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

  if (!plan || !plan.days || plan.days.length === 0) {
    return <div className={styles.container}>Nu s-a putut genera planul.</div>;
  }

  const currentDay = plan.days[activeDay];
  const canEditAmounts = editableAmounts && user?.role === 'trainer' && typeof onPlanChange === 'function';

  const handleFoodAmountChange = (mealIndex, foodIndex, nextAmount) => {
    const nextPlan = updateFoodAmount(plan, activeDay, mealIndex, foodIndex, nextAmount);
    onPlanChange?.(nextPlan);
    onPlanDirtyChange?.(true);
  };

  return (
    <div className={styles.container}>
      {/* Client Header */}
      {clientData && (
        <div className={styles.clientHeader}>
          <div className={styles.clientHeaderLeft}>
            <div>
              <h2 className={styles.clientName}>{clientData.name}</h2>
              <p className={styles.clientSub}>{goalLabels[clientData.goal]} · {dietLabels[clientData.dietType]}</p>
            </div>
          </div>
          <div className={styles.clientStats}>
            <div className={styles.clientStat}>
              <span className={styles.clientStatValue}>{clientData.age}</span>
              <span className={styles.clientStatLabel}>Vârstă</span>
            </div>
            <div className={styles.clientStat}>
              <span className={styles.clientStatValue}>{clientData.weight}</span>
              <span className={styles.clientStatLabel}>Greutate</span>
            </div>
            <div className={styles.clientStat}>
              <span className={styles.clientStatValue}>{clientData.height}</span>
              <span className={styles.clientStatLabel}>Înălțime</span>
            </div>
          </div>
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
            {plan.days.map((day, index) => (
              <button
                key={index}
                className={`${styles.dayTab} ${activeDay === index ? styles.dayTabActive : ''}`}
                onClick={() => setActiveDay(index)}
              >
                <span className={styles.dayFull}>{dayNames[index]}</span>
                <span className={styles.dayShort}>{dayNamesShort[index]}</span>
              </button>
            ))}
          </div>
          {!hideReviewActions && (
          <div className={styles.tabsActions}>
            {/* Buton pentru antrenor: vizualizează progresul clientului */}
            <button
              className={styles.updateProgressBtn}
              onClick={() => {
                console.log('Button clicked! onViewProgress:', onViewProgress);
                if (onViewProgress) {
                  onViewProgress();
                } else {
                  console.error('onViewProgress is not defined!');
                }
              }}
              title="Vizualizează progresul trimis de client"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              Vizualizează progres
            </button>
            <button
              className={`${styles.downloadBtn} ${pdfLoading ? styles.downloadBtnLoading : ''}`}
              onClick={handleDownload}
              disabled={pdfLoading}
              title="Descarcă plan PDF"
            >
              {pdfLoading ? (
                <>
                  <span className={styles.pdfSpinner} />
                  <span className={styles.downloadBtnLabel}>Se generează...</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  <span className={styles.downloadBtnLabel}>PDF</span>
                </>
              )}
            </button>
          </div>
          )}
        </div>

        {/* Day Totals */}
        {currentDay.dailyTotals && (
          <div className={styles.dayTotalsBar}>
            <span className={styles.dayTotalsLabel}>Total {dayNames[activeDay]}</span>
            <div className={styles.dayTotalsValues}>
              <span><strong>{currentDay.dailyTotals.calories}</strong> kcal</span>
              <span className={styles.dotLight}>·</span>
              <span><strong>{currentDay.dailyTotals.protein}g</strong> prot</span>
              <span className={styles.dotLight}>·</span>
              <span><strong>{currentDay.dailyTotals.carbs}g</strong> carbo</span>
              <span className={styles.dotLight}>·</span>
              <span><strong>{currentDay.dailyTotals.fat}g</strong> grăsimi</span>
            </div>
          </div>
        )}

        {/* Meals Grid for Active Day */}
        <div className={styles.mealsGrid}>
          {currentDay.meals.map((meal, mealIndex) => {
            const { name } = getMealLabel(meal.mealType);
            return (
              <div key={mealIndex} className={styles.mealCard}>
                <div className={styles.mealCardHeader}>
                  <h4>{meal.name || name}</h4>
                  {meal.mealTotals && (
                    <span className={styles.mealCalories}>{meal.mealTotals.calories} kcal</span>
                  )}
                </div>

                <ul className={styles.mealList}>
                  {meal.foods.map((food, foodIndex) => (
                    <li key={foodIndex} className={styles.mealItem}>
                      <div className={styles.foodMainRow}>
                        <span className={styles.foodName}>{food.name}</span>
                        {canEditAmounts ? (
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
                      <span className={styles.foodMacros}>
                        {food.nutritionNote ? '≈ ' : ''}{food.calories}kcal · P:{food.protein}g · C:{food.carbs}g · G:{food.fat}g
                      </span>
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
                    <span>P: {meal.mealTotals.protein}g</span>
                    <span>C: {meal.mealTotals.carbs}g</span>
                    <span>G: {meal.mealTotals.fat}g</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
