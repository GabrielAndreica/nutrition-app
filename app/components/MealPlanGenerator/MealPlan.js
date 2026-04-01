'use client';

import { useState, useEffect } from 'react';
import styles from './meal-plan.module.css';

export default function MealPlan({ plan, clientData, nutritionalNeeds, onReset, onRegenerate }) {
  const [activeDay, setActiveDay] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [weightHistory, setWeightHistory] = useState([]);
  const [stagnationWeeks, setStagnationWeeks] = useState(0);
  const [stagnationInfo, setStagnationInfo] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [progressErrors, setProgressErrors] = useState({});
  const [progressData, setProgressData] = useState({
    currentWeight: clientData?.weight || '',
    adherence: '',
    energyLevel: '',
    hungerLevel: '',
    notes: '',
  });

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
    setShowProgress(true);
    loadWeightHistory();
  };

  const validateProgressForm = () => {
    const errors = {};
    const w = progressData.currentWeight;

    if (!w && w !== 0) {
      errors.currentWeight = 'Greutatea este obligatorie.';
    } else {
      const num = parseFloat(w);
      if (isNaN(num)) {
        errors.currentWeight = 'Introdu o valoare numerică validă (ex: 73.5).';
      } else if (num <= 0) {
        errors.currentWeight = 'Greutatea trebuie să fie un număr pozitiv.';
      } else if (num < 30) {
        errors.currentWeight = 'Greutatea nu poate fi mai mică de 30 kg.';
      } else if (num > 300) {
        errors.currentWeight = 'Greutatea nu poate depăși 300 kg.';
      }
    }

    if (!progressData.adherence) errors.adherence = 'Selectează respectarea planului.';
    if (!progressData.energyLevel) errors.energyLevel = 'Selectează nivelul de energie.';
    if (!progressData.hungerLevel) errors.hungerLevel = 'Selectează nivelul de foame.';

    setProgressErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleProgressSubmit = () => {
    if (!validateProgressForm()) return;

    // Salvarea în weight_history se face în API-ul generate-meal-plan,
    // DUPĂ ce planul a fost generat și salvat cu succes.
    if (onRegenerate) {
      onRegenerate({
        ...progressData,
        weeksNoChange: String(stagnationWeeks),
      });
    }
    setShowProgress(false);
  };

  if (!plan || !plan.days || plan.days.length === 0) {
    return <div className={styles.container}>Nu s-a putut genera planul.</div>;
  }

  const currentDay = plan.days[activeDay];

  const activityLabels = {
    sedentary: 'Sedentar',
    lightly_active: 'Ușor activ',
    moderately_active: 'Moderat activ',
    very_active: 'Foarte activ',
    extra_active: 'Extrem de activ',
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
            {onRegenerate && (
              <button
                className={styles.updateProgressBtn}
                onClick={handleOpenProgress}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                  <path d="M16 16h5v5"/>
                </svg>
                Actualizează progres
              </button>
            )}
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

      {/* Modal Progres */}
      {showProgress && (
        <div className={styles.modalOverlay} onClick={() => setShowProgress(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Actualizare progres client</h3>
              <button className={styles.modalClose} onClick={() => setShowProgress(false)}>✕</button>
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
                <label>Observații antrenor (opțional)</label>
                <textarea
                  name="notes"
                  value={progressData.notes}
                  onChange={handleProgressChange}
                  placeholder="Notează observații relevante pentru noul plan..."
                  rows="3"
                />
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.modalCancelBtn} onClick={() => setShowProgress(false)}>
                Anulează
              </button>
              <button
                className={styles.modalSubmitBtn}
                onClick={handleProgressSubmit}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                  <path d="M16 16h5v5"/>
                </svg>
                Regenerează plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
