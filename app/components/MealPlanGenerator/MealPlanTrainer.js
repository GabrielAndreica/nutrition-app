'use client';

import { useState } from 'react';
import styles from './meal-plan.module.css';

export default function MealPlanTrainer({ plan, clientData, nutritionalNeeds, onReset, onRegenerate, onViewProgress }) {
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
    'Masa 1': { name: 'Masa 1', emoji: '🍽️' },
    'Masa 2': { name: 'Masa 2', emoji: '🍽️' },
    'Masa 3': { name: 'Masa 3', emoji: '🍽️' },
    'Gustare': { name: 'Gustare', emoji: '🍎' },
    'Gustare 1': { name: 'Gustare 1', emoji: '🍎' },
    'Gustare 2': { name: 'Gustare 2', emoji: '🥗' },
    'Breakfast': { name: 'Masa 1', emoji: '🍽️' },
    'Lunch': { name: 'Masa 2', emoji: '🍽️' },
    'Dinner': { name: 'Masa 3', emoji: '🍽️' },
    'Snack': { name: 'Gustare', emoji: '🍎' },
    'Snack 1': { name: 'Gustare 1', emoji: '🍎' },
    'Snack 2': { name: 'Gustare 2', emoji: '🥗' },
    'Mic Dejun': { name: 'Masa 1', emoji: '🍽️' },
    'Prânz': { name: 'Masa 2', emoji: '🍽️' },
    'Cină': { name: 'Masa 3', emoji: '🍽️' },
  };

  const getMealLabel = (mealType) => {
    return mealTypeLabels[mealType] || { name: mealType, emoji: '🍽️' };
  };

  const handleDownload = async () => {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const { generateMealPlanPDF } = await import('./generatePDF');
      generateMealPlanPDF(plan, clientData, nutritionalNeeds);
    } finally {
      setPdfLoading(false);
    }
  };

  // Debug log
  console.log('MealPlanTrainer - onViewProgress:', typeof onViewProgress, onViewProgress);
  console.log('MealPlanTrainer - clientData:', clientData?.clientId);

  if (!plan || !plan.days || plan.days.length === 0) {
    return <div className={styles.container}>Nu s-a putut genera planul.</div>;
  }

  const currentDay = plan.days[activeDay];

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
              <span className={styles.clientStatLabel}>ani</span>
            </div>
            <div className={styles.clientStat}>
              <span className={styles.clientStatValue}>{clientData.weight}</span>
              <span className={styles.clientStatLabel}>kg</span>
            </div>
            <div className={styles.clientStat}>
              <span className={styles.clientStatValue}>{clientData.height}</span>
              <span className={styles.clientStatLabel}>cm</span>
            </div>
            {clientData.activityLevel && (
              <div className={styles.clientStat}>
                <span className={styles.clientStatValue}>{activityLabels[clientData.activityLevel] || clientData.activityLevel}</span>
                <span className={styles.clientStatLabel}>activitate</span>
              </div>
            )}
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
            const { name, emoji } = getMealLabel(meal.mealType);
            return (
              <div key={mealIndex} className={styles.mealCard}>
                <div className={styles.mealCardHeader}>
                  <span className={styles.mealEmoji}>{emoji}</span>
                  <h4>{name}</h4>
                  {meal.mealTotals && (
                    <span className={styles.mealCalories}>{meal.mealTotals.calories} kcal</span>
                  )}
                </div>

                <ul className={styles.mealList}>
                  {meal.foods.map((food, foodIndex) => (
                    <li key={foodIndex} className={styles.mealItem}>
                      <span className={styles.foodName}>
                        {food.name} ({food.amount}{food.unit})
                      </span>
                      <span className={styles.foodMacros}>
                        {food.calories}kcal · P:{food.protein}g · C:{food.carbs}g · G:{food.fat}g
                      </span>
                    </li>
                  ))}
                </ul>

                {meal.preparation && (
                  <div className={styles.preparation}>
                    <span className={styles.prepIcon}>👨‍🍳</span> {meal.preparation}
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
