'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import styles from '@/app/clients/clients.module.css';
import mealPlanStyles from '@/app/components/MealPlanGenerator/meal-plan.module.css';
import viewStyles from '@/app/meal-plan/meal-plan-view.module.css';

// Label constants
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

const activityLabels = {
  sedentary: 'Sedentar',
  lightly_active: 'Ușor activ',
  moderately_active: 'Moderat activ',
  very_active: 'Foarte activ',
  extra_active: 'Extrem de activ',
};

export default function InlineProgressView({ clientId, scrollContainerRef, onBack, onGeneratePlan }) {
  const router = useRouter();
  const [client, setClient] = useState(null);
  const [progressData, setProgressData] = useState(null);
  const [weightHistory, setWeightHistory] = useState([]);
  const [stagnationWeeks, setStagnationWeeks] = useState(0);
  const [nutritionalNeeds, setNutritionalNeeds] = useState(null);
  const [planId, setPlanId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newWeight, setNewWeight] = useState('');

  // Scroll to top când se montează componenta
  useEffect(() => {
    scrollContainerRef?.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [scrollContainerRef]);

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  }), []);

  // Memoized AI recommendation computation
  const computeAiRecommendation = useCallback((data, stagnationWeeks, client, nutritionalNeeds) => {
    const goal = client?.goal || 'maintenance';
    const adherence = data.respectare?.toLowerCase();
    const energy = data.energie?.toLowerCase();
    const hunger = data.foame?.toLowerCase();
    const currentCal = nutritionalNeeds?.calories || null;

    let action = 'continue';
    let calChange = 0;
    let reason = '';

    if (hunger === 'extrem' || (hunger === 'crescut' && energy === 'scazut')) {
      action = 'regenerate';
      calChange = goal === 'weight_loss' ? +100 : +150;
      reason = hunger === 'extrem'
        ? 'Foame extremă — deficit prea agresiv'
        : 'Foame crescută + energie scăzută — necesită ajustare';
    } else if (stagnationWeeks >= 2) {
      action = 'regenerate';
      if (goal === 'weight_loss') {
        calChange = adherence === 'complet' ? -100 : -150;
        reason = `Stagnare ${stagnationWeeks} săptămâni — reducere deficit`;
      } else if (goal === 'muscle_gain') {
        calChange = +100;
        reason = `Stagnare ${stagnationWeeks} săptămâni — creștere surplus`;
      } else {
        calChange = 0;
        reason = `Stagnare ${stagnationWeeks} săptămâni — reechilibrare macronutrienți`;
      }
    } else if (stagnationWeeks === 1 && adherence === 'complet') {
      action = 'continue';
      reason = 'O săptămână fără schimbare — este prea devreme pentru ajustare';
    } else {
      action = 'continue';
      reason = 'Progres conform așteptărilor — planul funcționează';
    }

    const targetCal = currentCal ? currentCal + calChange : null;
    return { action, calChange, reason, targetCal, currentCal };
  }, []); // Empty deps - pure calculation

  // Memoized AI recommendation result
  const aiRecommendation = useMemo(() => {
    if (!progressData || !client) return null;
    return computeAiRecommendation(progressData, stagnationWeeks, client, nutritionalNeeds);
  }, [progressData, stagnationWeeks, client, nutritionalNeeds, computeAiRecommendation]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Fetch client data
        const clientRes = await fetch(`/api/clients/${clientId}`, { headers: authHeaders() });
        const clientData = await clientRes.json();
        if (!clientRes.ok) throw new Error(clientData.error || 'Eroare la încărcarea clientului');
        setClient(clientData.client);
        
        // Fetch weight history
        const whRes = await fetch(`/api/clients/${clientId}/weight-history`, { headers: authHeaders() });
        const whData = await whRes.json();
        if (!whRes.ok) throw new Error(whData.error || 'Eroare la încărcare');
        setWeightHistory(whData.weightHistory || []);
        setStagnationWeeks(whData.stagnationWeeks || 0);

        // Find most recent client progress entry
        const clientEntry = (whData.weightHistory || [])
          .filter(e => e.notes?.startsWith('[CLIENT]'))
          .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))[0];
        
        if (clientEntry) {
          const notesBody = clientEntry.notes.slice('[CLIENT] '.length);
          const parsed = {};
          notesBody.split(' | ').forEach(part => {
            const colonIdx = part.indexOf(': ');
            if (colonIdx !== -1) parsed[part.slice(0, colonIdx)] = part.slice(colonIdx + 2);
          });
          setProgressData({
            weight: clientEntry.weight,
            recordedAt: clientEntry.recorded_at,
            respectare: parsed['Respectare'] || '-',
            energie: parsed['Energie'] || '-',
            foame: parsed['Foame'] || '-',
            mesaj: parsed['Mesaj'] || '',
          });
          setNewWeight(String(clientEntry.weight));
        }

        // Fetch current plan for nutritional needs
        const plansRes = await fetch('/api/meal-plans', { headers: authHeaders() });
        if (plansRes.ok) {
          const plansData = await plansRes.json();
          // plansData.plans este un obiect { clientId: { planId, createdAt } }
          if (plansData.plans && plansData.plans[clientId]) {
            const clientPlanInfo = plansData.plans[clientId];
            setPlanId(clientPlanInfo.planId);
            // Fetch full plan details for nutritional needs
            const planRes = await fetch(`/api/meal-plans/${clientPlanInfo.planId}`, { headers: authHeaders() });
            if (planRes.ok) {
              const planData = await planRes.json();
              if (planData.mealPlan?.daily_targets) {
                setNutritionalNeeds(planData.mealPlan.daily_targets);
              }
            }
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (clientId) {
      fetchData();
    }
  }, [clientId, authHeaders]);

  const handleContinue = () => {
    // Marchează progresul ca vizualizat și întoarce-te
    onBack();
  };

  const handleGenerate = async () => {
    if (!client || !progressData) return;
    setSaving(true);
    
    const weightVal = parseFloat(newWeight);
    const hasNewWeight = newWeight.trim() !== '' && !isNaN(weightVal) && weightVal >= 30 && weightVal <= 300;

    try {
      if (hasNewWeight) {
        const res = await fetch(`/api/clients/${client.id}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({
            name: client.name,
            age: String(client.age),
            weight: String(weightVal),
            height: String(client.height),
            gender: client.gender,
            goal: client.goal,
            activityLevel: client.activity_level,
            dietType: client.diet_type,
            allergies: client.allergies || '',
            mealsPerDay: String(client.meals_per_day),
            foodPreferences: client.food_preferences || '',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Eroare la actualizare');
      }

      // Stochează datele de progres pentru generator
      sessionStorage.setItem('clientProgress', JSON.stringify({
        currentWeight: String(hasNewWeight ? weightVal : progressData.weight),
        adherence: progressData.respectare,
        energyLevel: progressData.energie,
        hungerLevel: progressData.foame,
        notes: progressData.mesaj || '',
        weeksNoChange: String(stagnationWeeks),
      }));

      // Stochează necesarul nutrițional curent pentru diff-ul macro după generare
      if (planId) {
        try {
          const planRes = await fetch(`/api/meal-plans/${planId}`, { headers: authHeaders() });
          if (planRes.ok) {
            const planData = await planRes.json();
            if (planData.mealPlan?.daily_targets) {
              sessionStorage.setItem('clientPreviousNeeds', JSON.stringify(planData.mealPlan.daily_targets));
            }
          }
        } catch { /* non-critical */ }
      }

      setSaving(false);
      
      if (onGeneratePlan) {
        onGeneratePlan(client.id);
      } else {
        router.push(`/generator-plan?clientId=${client.id}&fromProgress=true`);
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const aiRec = progressData && client
    ? computeAiRecommendation(progressData, stagnationWeeks, client, nutritionalNeeds)
    : null;

  const handleBackToPlan = () => {
    // Navighează înapoi la planul alimentar
    if (planId) {
      onBack(planId); // Trimite planId la dashboard pentru a afișa planul
    } else {
      onBack(); // Dacă nu există plan, închide doar view-ul
    }
  };

  return (
    <div className={styles.progressInlinePage}>
      {/* Navigare înapoi + butoane acțiuni */}
      <div className={viewStyles.navRow}>
        <button className={viewStyles.navBackBtn} onClick={handleBackToPlan} aria-label="Înapoi la plan">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        
        <div className={viewStyles.planTabsToggle}>
          <button
            className={`${viewStyles.planTab} ${viewStyles.planTabActive}`}
            onClick={handleBackToPlan}
          >
            Plan alimentar
          </button>
          <button
            className={viewStyles.planTab}
            disabled
            title="Va fi disponibil în curând"
          >
            Plan de antrenament
          </button>
        </div>
      </div>

      {loading && (
        <>
          {/* Skeleton client header */}
          <div className={mealPlanStyles.clientHeader} style={{ opacity: 0.6 }}>
            <div className={mealPlanStyles.clientHeaderLeft}>
              <div>
                <div className={viewStyles.shimmer} style={{ width: '180px', height: '24px', borderRadius: '6px', marginBottom: '8px' }} />
                <div className={viewStyles.shimmer} style={{ width: '220px', height: '14px', borderRadius: '4px' }} />
              </div>
            </div>
            <div className={mealPlanStyles.clientStats}>
              {[1, 2, 3, 4].map(i => (
                <div key={i} className={mealPlanStyles.clientStat}>
                  <div className={viewStyles.shimmer} style={{ width: '32px', height: '20px', borderRadius: '4px', marginBottom: '4px' }} />
                  <div className={viewStyles.shimmer} style={{ width: '24px', height: '12px', borderRadius: '3px' }} />
                </div>
              ))}
            </div>
          </div>

          {/* Skeleton progress card */}
          <div className={styles.progressInlineCard}>
            <div className={styles.progressSheetMainGrid}>
              {/* Feedback column */}
              <div className={styles.progressSheetSection}>
                <div className={viewStyles.shimmer} style={{ width: '100px', height: '12px', borderRadius: '4px', marginBottom: '16px' }} />
                <div className={styles.progressSheetColumn}>
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className={styles.progressSheetKv} style={{ opacity: 0.6 }}>
                      <div className={viewStyles.shimmer} style={{ width: '120px', height: '11px', borderRadius: '3px', marginBottom: '6px' }} />
                      <div className={viewStyles.shimmer} style={{ width: '80px', height: '16px', borderRadius: '4px' }} />
                    </div>
                  ))}
                </div>
              </div>

              {/* History column */}
              <div className={styles.progressSheetSection}>
                <div className={viewStyles.shimmer} style={{ width: '120px', height: '12px', borderRadius: '4px', marginBottom: '16px' }} />
                <div className={styles.progressSheetHistoryTable} style={{ opacity: 0.6 }}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className={styles.progressSheetHistoryRow}>
                      <div className={viewStyles.shimmer} style={{ width: '70px', height: '13px', borderRadius: '4px' }} />
                      <div className={viewStyles.shimmer} style={{ width: '50px', height: '15px', borderRadius: '4px' }} />
                      <div className={viewStyles.shimmer} style={{ width: '60px', height: '13px', borderRadius: '4px' }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Skeleton AI section */}
            <div className={styles.progressSheetAiRow} style={{ opacity: 0.6 }}>
              <div className={viewStyles.shimmer} style={{ width: '140px', height: '12px', borderRadius: '4px', marginBottom: '12px' }} />
              <div style={{ display: 'flex', gap: '10px' }}>
                <div className={viewStyles.shimmer} style={{ width: '48%', height: '80px', borderRadius: '12px' }} />
                <div className={viewStyles.shimmer} style={{ width: '48%', height: '80px', borderRadius: '12px' }} />
              </div>
            </div>

            {/* Skeleton footer */}
            <div className={styles.progressSheetFooter} style={{ opacity: 0.6 }}>
              <div className={viewStyles.shimmer} style={{ width: '100px', height: '38px', borderRadius: '8px' }} />
              <div className={viewStyles.shimmer} style={{ width: '140px', height: '38px', borderRadius: '8px' }} />
            </div>
          </div>
        </>
      )}

      {error && !loading && (
        <div className={styles.progressInlineCard}>
          <div className={styles.formError} style={{ margin: '20px' }}>{error}</div>
          <div className={styles.progressSheetFooter}>
            <button className={styles.backBtnAlt} onClick={() => onBack()}>Înapoila clienți</button>
          </div>
        </div>
      )}

      {!loading && !error && client && (
        <>
          {/* Header client cu date complete */}
          <div className={mealPlanStyles.clientHeader}>
            <div className={mealPlanStyles.clientHeaderLeft}>
              <div>
                <h2 className={mealPlanStyles.clientName}>{client.name}</h2>
                <p className={mealPlanStyles.clientSub}>
                  {client.goal && `${goalLabels[client.goal] || client.goal} · `}
                  {client.diet_type && `${dietLabels[client.diet_type] || client.diet_type}`}
                  {progressData && ` · Progres ${new Date(progressData.recordedAt).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })}`}
                </p>
              </div>
            </div>
            <div className={mealPlanStyles.clientStats}>
              {client.age && (
                <div className={mealPlanStyles.clientStat}>
                  <span className={mealPlanStyles.clientStatValue}>{client.age}</span>
                  <span className={mealPlanStyles.clientStatLabel}>ani</span>
                </div>
              )}
              {client.weight && (
                <div className={mealPlanStyles.clientStat}>
                  <span className={mealPlanStyles.clientStatValue}>{client.weight}</span>
                  <span className={mealPlanStyles.clientStatLabel}>kg</span>
                </div>
              )}
              {client.height && (
                <div className={mealPlanStyles.clientStat}>
                  <span className={mealPlanStyles.clientStatValue}>{client.height}</span>
                  <span className={mealPlanStyles.clientStatLabel}>cm</span>
                </div>
              )}
              {client.activity_level && (
                <div className={mealPlanStyles.clientStat}>
                  <span className={mealPlanStyles.clientStatValue}>{activityLabels[client.activity_level] || client.activity_level}</span>
                  <span className={mealPlanStyles.clientStatLabel}>activitate</span>
                </div>
              )}
            </div>
          </div>

          {/* Card principal */}
          <div className={styles.progressInlineCard}>
            {!progressData ? (
              <>
                <p className={styles.progressSheetEmpty}>Nu există progres trimis recent de acest client.</p>
                <div className={styles.progressSheetFooter}>
                  <button className={styles.backBtnAlt} onClick={() => onBack()}>Înapoi la clienți</button>
                </div>
              </>
            ) : (
              <>
                {/* Layout cu 2 coloane: Feedback + Istoric */}
                <div className={styles.progressSheetMainGrid}>
                  {/* Coloana stângă: Feedback client */}
                  <div className={styles.progressSheetSection}>
                    <p className={styles.progressSheetSectionTitle}>Feedback client</p>
                    <div className={styles.progressSheetColumn}>
                      <div className={styles.progressSheetKv}>
                        <span className={styles.progressSheetKey}>Greutate raportată</span>
                        <span className={styles.progressSheetVal}>{progressData.weight} kg</span>
                      </div>
                      <div className={styles.progressSheetKv}>
                        <span className={styles.progressSheetKey}>Respectare plan</span>
                        <span className={`${styles.progressSheetVal} ${styles.progressSheetCapitalize}`}>{progressData.respectare}</span>
                      </div>
                      <div className={styles.progressSheetKv}>
                        <span className={styles.progressSheetKey}>Nivel energie</span>
                        <span className={`${styles.progressSheetVal} ${styles.progressSheetCapitalize}`}>{progressData.energie}</span>
                      </div>
                      <div className={styles.progressSheetKv}>
                        <span className={styles.progressSheetKey}>Nivel foame</span>
                        <span className={`${styles.progressSheetVal} ${styles.progressSheetCapitalize}`}>{progressData.foame}</span>
                      </div>
                    </div>
                    {progressData.mesaj && (
                      <div className={styles.progressSheetMessage}>
                        <span className={styles.progressSheetKey}>Mesaj</span>
                        <p className={styles.progressSheetMessageText}>{progressData.mesaj}</p>
                      </div>
                    )}
                  </div>

                  {/* Coloana dreaptă: Istoric greutăți */}
                  {weightHistory.length > 0 && (
                    <div className={styles.progressSheetSection}>
                      <p className={styles.progressSheetSectionTitle}>
                        Ultimele {Math.min(5, weightHistory.length)} greutăți
                      </p>
                      <div className={styles.progressSheetHistoryTable}>
                        {weightHistory.slice(0, 5).map((entry, idx, arr) => {
                          const diff = idx < arr.length - 1
                            ? (entry.weight - arr[idx + 1].weight).toFixed(1)
                            : null;
                          const isLatest = idx === 0;
                          return (
                            <div key={entry.id || idx} className={`${styles.progressSheetHistoryRow} ${isLatest ? styles.progressSheetHistoryRowLatest : ''}`}>
                              <span className={styles.progressSheetHistoryDate}>
                                {new Date(entry.recorded_at).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })}
                                {isLatest && <span className={styles.latestLabel}> • Acum</span>}
                              </span>
                              <span className={styles.progressSheetHistoryWeight}>{entry.weight} kg</span>
                              {diff !== null && (
                                <span className={parseFloat(diff) < 0 ? styles.progressSheetDiffDown : parseFloat(diff) > 0 ? styles.progressSheetDiffUp : styles.progressSheetDiffNeutral}>
                                  {parseFloat(diff) > 0 ? '+' : ''}{diff} kg
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Recomandare AI - jos de tot */}
                {aiRec && (
                  <div className={aiRec.action === 'regenerate' ? styles.progressSheetAiRegen : styles.progressSheetAiContinue}>
                    <div className={styles.progressSheetAiTop}>
                      <span className={styles.progressSheetAiIcon}>
                        {aiRec.action === 'regenerate' ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10"/>
                            <polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </span>
                      <div style={{ flex: 1 }}>
                        <p className={styles.progressSheetAiLabel}>
                          {aiRec.action === 'regenerate' ? 'Recomandare: Generează plan nou' : 'Recomandare: Continuă planul actual'}
                        </p>
                        <p className={styles.progressSheetAiReason}>{aiRec.reason}</p>
                        {aiRec.action === 'regenerate' && aiRec.calChange !== 0 && (
                          <div className={styles.progressSheetAiCalRow}>
                            {aiRec.currentCal && (
                              <><span className={styles.progressSheetAiCalOld}>{aiRec.currentCal} kcal</span>
                              <span className={styles.progressSheetAiArrow}>→</span></>
                            )}
                            {aiRec.targetCal && (
                              <span className={styles.progressSheetAiCalNew}>{aiRec.targetCal} kcal</span>
                            )}
                            <span className={aiRec.calChange < 0 ? styles.progressSheetAiCalDiffDown : styles.progressSheetAiCalDiffUp}>
                              {aiRec.calChange > 0 ? '+' : ''}{aiRec.calChange}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {error && <div className={styles.formError} style={{ margin: '0 32px 16px' }}>{error}</div>}

                <div className={styles.progressSheetFooter}>
                  <button className={styles.cancelBtn} onClick={handleContinue} disabled={saving}>
                    Continuă planul
                  </button>
                  <button className={styles.saveBtn} onClick={handleGenerate} disabled={saving}>
                    {saving
                      ? <><span className={styles.savingSpinner} />Se pregătește...</>
                      : 'Generează plan nou'}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
