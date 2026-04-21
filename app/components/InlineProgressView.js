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
  const [previousPlanCalories, setPreviousPlanCalories] = useState(null);
  const [planId, setPlanId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  const [planContinued, setPlanContinued] = useState(false);
  const [lastProgressId, setLastProgressId] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [generatingProgress, setGeneratingProgress] = useState(0);
  const [generatingDay, setGeneratingDay] = useState(0);

  // Scroll to top când se montează componenta
  useEffect(() => {
    scrollContainerRef?.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [scrollContainerRef]);

  // Auto-close banner după 5 secunde
  useEffect(() => {
    if (showBanner) {
      const timer = setTimeout(() => {
        setShowBanner(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showBanner]);

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  }), []);

  // Memoized AI recommendation computation
  const computeAiRecommendation = useCallback((data, stagnationWeeks, client, nutritionalNeeds, weightHistory, previousPlanCalories) => {
    const goal = client?.goal || 'maintenance';
    const adherence = data.respectare?.toLowerCase();
    const energy = data.energie?.toLowerCase();
    const hunger = data.foame?.toLowerCase();
    
    // Dacă planul are previous_plan_calories (generat din progres), folosește acela pentru comparație
    // Altfel folosește caloriile planului curent
    const currentCal = previousPlanCalories || nutritionalNeeds?.calories || null;
    if (previousPlanCalories) {
    } else {
    }

    let action = 'continue';
    let calChange = 0;
    let reason = '';

    // Calculează schimbarea de greutate față de greutatea anterioară [CLIENT]
    let weightChangePercent = 0;
    const currentWeight = parseFloat(data.weight);
    let previousWeight = null;
    
    // Filtrează doar intrările [CLIENT] din istoric pentru comparație corectă
    const clientEntries = weightHistory?.filter(e => e.notes?.startsWith('[CLIENT]')) || [];
    
    // Sortează descrescător după dată (cele mai recente primele)
    clientEntries.sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
    
    
    // Intrarea curentă este cel mai recent [CLIENT] (indexul 0)
    // Caută a doua intrare [CLIENT] pentru comparație (indexul 1)
    if (clientEntries.length >= 2) {
      const prevEntry = clientEntries[1];
      previousWeight = parseFloat(prevEntry.weight);
    } else if (clientEntries.length === 1 && client?.weight) {
      // Prima intrare de la client - comparăm cu greutatea inițială din profil
      previousWeight = parseFloat(client.weight);
    }
    
    if (previousWeight && currentWeight && Math.abs(currentWeight - previousWeight) > 0.05) {
      weightChangePercent = ((currentWeight - previousWeight) / previousWeight) * 100;
    } else {
    }

    // Verifică dacă schimbarea de greutate e în afara intervalului optim
    let isWeightSuboptimal = false;
    if (goal === 'weight_loss') {
      // Cut: ar trebui -0.2% până la -1.0% pe săptămână
      // Prea puțin sau creștere = suboptimal
      if (weightChangePercent > -0.2) {
        isWeightSuboptimal = true;
        calChange = -125;
        reason = weightChangePercent > 0 
          ? `Greutate crescută cu ${weightChangePercent.toFixed(1)}% — reducere calorii necesară`
          : 'Progres prea lent — reducere calorii pentru accelerare';
        action = 'regenerate';
      }
      // Prea mult slăbit = suboptimal
      else if (weightChangePercent < -1.0) {
        isWeightSuboptimal = true;
        calChange = +125;
        reason = `Slăbire prea rapidă (${Math.abs(weightChangePercent).toFixed(1)}%) — creștere calorii pentru sustenabilitate`;
        action = 'regenerate';
      }
    } else if (goal === 'maintenance') {
      // Menținere: ±0.3% e ideal
      const tolerance = 0.5; // toleranță extinsă
      if (Math.abs(weightChangePercent) > tolerance) {
        isWeightSuboptimal = true;
        if (weightChangePercent > tolerance) {
          calChange = -100;
          reason = `Greutate crescută cu ${weightChangePercent.toFixed(1)}% — reducere calorii pentru menținere`;
        } else {
          calChange = +100;
          reason = `Greutate scăzută cu ${Math.abs(weightChangePercent).toFixed(1)}% — creștere calorii pentru menținere`;
        }
        action = 'regenerate';
      }
    } else if (goal === 'muscle_gain') {
      // Masă: +0.25% până la +0.50% e optim
      if (weightChangePercent < 0.25) {
        isWeightSuboptimal = true;
        calChange = +125;
        reason = weightChangePercent < 0
          ? `Greutate scăzută (${weightChangePercent.toFixed(1)}%) — creștere surplus pentru masă`
          : 'Progres prea lent — creștere surplus pentru creștere musculară';
        action = 'regenerate';
      } else if (weightChangePercent > 0.75) {
        isWeightSuboptimal = true;
        calChange = -100;
        reason = `Creștere prea rapidă (${weightChangePercent.toFixed(1)}%) — risc grăsime, reducere surplus`;
        action = 'regenerate';
      }
    }

    // Dacă nu e suboptimal din greutate, verifică foamea și stagnarea
    if (!isWeightSuboptimal) {
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
    }

    const targetCal = currentCal ? currentCal + calChange : null;
    return { action, calChange, reason, targetCal, currentCal };
  }, []); // Empty deps - pure calculation

  // Memoized AI recommendation result
  const aiRecommendation = useMemo(() => {
    if (!progressData || !client) return null;
    return computeAiRecommendation(progressData, stagnationWeeks, client, nutritionalNeeds, weightHistory, previousPlanCalories);
  }, [progressData, stagnationWeeks, client, nutritionalNeeds, weightHistory, previousPlanCalories, computeAiRecommendation]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      // ─── Optimizare: Timeout 10s pentru toate fetch-urile ───────
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      try {
        // ─── Optimizare: Fetch-uri în PARALEL în loc de secvențial ───────
        const [clientRes, whRes, plansRes] = await Promise.all([
          fetch(`/api/clients/${clientId}`, { 
            headers: authHeaders(),
            signal: controller.signal 
          }),
          fetch(`/api/clients/${clientId}/weight-history`, { 
            headers: authHeaders(),
            signal: controller.signal 
          }),
          fetch('/api/meal-plans', { 
            headers: authHeaders(),
            signal: controller.signal 
          })
        ]);
        
        clearTimeout(timeoutId);
        
        if (!clientRes.ok) {
          throw new Error(`Eroare la încărcarea clientului: ${clientRes.status}`);
        }
        if (!whRes.ok) {
          throw new Error(`Eroare la încărcare istoric: ${whRes.status}`);
        }
        
        const [clientData, whData, plansData] = await Promise.all([
          clientRes.json(),
          whRes.json(),
          plansRes.ok ? plansRes.json() : null
        ]);
        
        setClient(clientData.client);
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
          setLastProgressId(clientEntry.id);
          
          // Dacă DB spune că există progres netratat (has_new_progress=true),
          // înseamnă că e un progres NOU — ștergem cheia veche din sessionStorage
          // și lăsăm butoanele active.
          const continuedKey = `plan_continued_${clientId}_${clientEntry.id}`;
          if (clientData.client?.has_new_progress) {
            sessionStorage.removeItem(continuedKey);
          } else {
            const wasContinued = sessionStorage.getItem(continuedKey);
            if (wasContinued) setPlanContinued(true);
          }
        }

        // ─── Optimizare: Fetch plan details doar dacă avem planId ───────
        if (plansData?.plans?.[clientId]) {
          const clientPlanInfo = plansData.plans[clientId];
          setPlanId(clientPlanInfo.planId);
          
          // Fetch plan details pentru nutritional needs
          const planController = new AbortController();
          const planTimeoutId = setTimeout(() => planController.abort(), 5000);
          
          try {
            const planRes = await fetch(`/api/meal-plans/${clientPlanInfo.planId}`, { 
              headers: authHeaders(),
              signal: planController.signal
            });
            clearTimeout(planTimeoutId);
            
            if (planRes.ok) {
              const planData = await planRes.json();
              if (planData.mealPlan?.daily_targets) {
                setNutritionalNeeds(planData.mealPlan.daily_targets);
              }
              if (planData.previousPlanCalories) {
                setPreviousPlanCalories(planData.previousPlanCalories);
              }
            }
          } catch (planErr) {
            clearTimeout(planTimeoutId);
            if (planErr.name !== 'AbortError') {
              console.warn('Plan fetch failed, continuing without nutritional needs:', planErr);
            }
          }
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          setError('Timeout la încărcarea datelor. Încearcă din nou.');
        } else {
          console.error('[InlineProgressView] Error fetching data:', err);
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    };

    if (clientId) {
      fetchData();
    }
  }, [clientId, authHeaders]);

  const handleContinue = async () => {
    if (lastProgressId) {
      const continuedKey = `plan_continued_${clientId}_${lastProgressId}`;
      sessionStorage.setItem(continuedKey, 'true');
    }
    setPlanContinued(true);
    setShowBanner(true);

    // Șterge badge-ul din DB
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ has_new_progress: false }),
      });
    } catch (err) {
      console.error('[handleContinue] PATCH error:', err);
    }
  };

  const handleGenerate = async () => {
    if (!client || !progressData) return;
    setSaving(true);

    try {
      // Găsește greutatea ANTERIOARĂ din weightHistory pentru calcul corect în API
      // Nu folosim client.weight pentru că poate fi deja actualizat de trigger
      let oldWeight = null;
      const clientEntries = weightHistory?.filter(e => e.notes?.startsWith('[CLIENT]')) || [];
      clientEntries.sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
      
      if (clientEntries.length >= 2) {
        // Avem cel puțin 2 intrări CLIENT - luăm penultima
        oldWeight = parseFloat(clientEntries[1].weight);
      } else if (clientEntries.length === 1) {
        // Prima intrare CLIENT - nu avem greutate anterioară, folosim cea curentă
        oldWeight = parseFloat(progressData.weight);
      }
      
      if (oldWeight) {
        sessionStorage.setItem('clientOldWeight', String(oldWeight));
      }

      // Stochează datele de progres pentru generator
      sessionStorage.setItem('clientProgress', JSON.stringify({
        currentWeight: String(progressData.weight), // greutatea nouă din progresul clientului
        adherence: progressData.respectare,
        energyLevel: progressData.energie,
        hungerLevel: progressData.foame,
        notes: progressData.mesaj || '',
        weeksNoChange: String(stagnationWeeks),
        forceRegenerate: true, // Flag pentru a indica că antrenorul vrea explicit regenerare
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
      
      // Marchează progresul ca fiind tratat (s-a generat plan nou) + şterge badge din DB
      if (lastProgressId) {
        const continuedKey = `plan_continued_${clientId}_${lastProgressId}`;
        sessionStorage.setItem(continuedKey, 'true');
        setPlanContinued(true);
      }
      // Persist în DB
      try {
        const token = localStorage.getItem('token');
        await fetch(`/api/clients/${clientId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ has_new_progress: false }),
        });
      } catch { /* non-critical */ }
      
      
      if (onGeneratePlan) {
        onGeneratePlan(client.id, true);
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const aiRec = progressData && client
    ? computeAiRecommendation(progressData, stagnationWeeks, client, nutritionalNeeds, weightHistory)
    : null;

  const handleBackToPlan = () => {
    if (planId) {
      onBack(planId);
    } else {
      onBack();
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

          {/* Banner plan continuat */}
          {planContinued && showBanner && (
            <div className={styles.progressOptimalBanner}>
              <span className={styles.progressOptimalIcon}>✓</span>
              <div className={styles.progressOptimalText}>
                <strong>Planul a rămas neschimbat</strong>
                <p>Clientul va continua cu același plan alimentar.</p>
              </div>
            </div>
          )}

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

                {/* Recomandare AI - jos de tot (ascunsă după ce s-a generat plan) */}
                {aiRec && !planContinued && (
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
                  {planContinued ? (
                    <button className={styles.disabledProgressBtn} disabled>
                      Progresul a fost deja tratat
                    </button>
                  ) : (
                    <>
                      <button className={styles.cancelBtn} onClick={handleContinue} disabled={saving}>
                        Continuă planul
                      </button>
                      <button className={styles.saveBtn} onClick={handleGenerate} disabled={saving}>
                        {saving
                          ? <><span className={styles.savingSpinner} />Se pregătește...</>
                          : 'Generează plan nou'}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
