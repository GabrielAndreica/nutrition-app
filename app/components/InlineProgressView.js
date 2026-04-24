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
  sedentary: 'Sedentară',
  light: 'Ușor activă',
  lightly_active: 'Ușor activă',
  moderate: 'Moderată',
  moderately_active: 'Moderată',
  active: 'Activă',
  very_active: 'Foarte activă',
  extra_active: 'Extrem de activă',
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

  // ─── Logică identică cu calculateCalorieAdjustment din route.js ───────────
  // Orice modificare TREBUIE replicată și în app/api/generate-meal-plan/route.js
  const calcWeightBasedAdjustment = useCallback((goal, weightChangePercent, weekNumber = 99) => {
    const pct = weightChangePercent;

    if (goal === 'weight_loss') {
      const isEarlyCut = weekNumber <= 2;
      if (isEarlyCut) {
        // Săpt. 1-2: pierdere rapidă e normală (apă + glicogen) — interval optim extins la -2.5%
        if (pct >= 1.0)  return { adj: -350, reason: `Creștere rapidă (+${pct.toFixed(1)}%) — deficit caloric mare necesar.` };
        if (pct >= 0.5)  return { adj: -275, reason: `Creștere moderată (+${pct.toFixed(1)}%) — deficit caloric semnificativ.` };
        if (pct >= 0.0)  return { adj: -200, reason: 'Greutate stabilă sau ușor crescută — deficit caloric moderat.' };
        if (pct >= -0.2) return { adj: -150, reason: 'Pierdere foarte lentă (0–0.2%) — deficit ușor crescut.' };
        if (pct >= -2.5) return { adj:    0, reason: `Săpt. ${weekNumber} de cut — pierdere rapidă (${Math.abs(pct).toFixed(1)}%) normală în faza inițială (apă + glicogen). Planul se menține.` };
        if (pct >= -3.5) return { adj: +150, reason: `Săpt. ${weekNumber} de cut — pierdere foarte rapidă (${Math.abs(pct).toFixed(1)}%) chiar și în faza inițială.` };
        return              { adj: +250, reason: `Săpt. ${weekNumber} de cut — pierdere extremă (${Math.abs(pct).toFixed(1)}%).` };
      }
      // Săpt. 3+: interval normal -0.2% … -1.0%
      if (pct >= 1.0)  return { adj: -350, reason: `Creștere rapidă (+${pct.toFixed(1)}%) — deficit caloric mare necesar.` };
      if (pct >= 0.5)  return { adj: -275, reason: `Creștere moderată (+${pct.toFixed(1)}%) — deficit caloric semnificativ.` };
      if (pct >= 0.0)  return { adj: -200, reason: 'Greutate stabilă sau ușor crescută — deficit caloric moderat.' };
      if (pct >= -0.2) return { adj: -150, reason: 'Pierdere foarte lentă (0–0.2%) — deficit ușor crescut.' };
      // interval optim: -0.2% … -1.0%
      if (pct >= -1.3) return { adj: +100, reason: `Pierdere ușor prea rapidă (${Math.abs(pct).toFixed(1)}%) — creștere mică de calorii.` };
      if (pct >= -1.8) return { adj: +175, reason: `Pierdere rapidă (${Math.abs(pct).toFixed(1)}%) — creștere moderată de calorii.` };
      if (pct >= -2.5) return { adj: +250, reason: `Pierdere foarte rapidă (${Math.abs(pct).toFixed(1)}%) — creștere importantă de calorii.` };
      return              { adj: +325, reason: `Pierdere extremă (${Math.abs(pct).toFixed(1)}%) — creștere mare de calorii.` };
    }

    if (goal === 'muscle_gain') {
      if (pct <= -0.5) return { adj: +300, reason: `Pierdere în greutate pe masă (${pct.toFixed(1)}%) — surplus caloric mare necesar.` };
      if (pct <= 0.0)  return { adj: +225, reason: 'Greutate stabilă sau ușor scăzută pe masă — surplus caloric semnificativ.' };
      if (pct <= 0.25) return { adj: +150, reason: `Creștere prea lentă (${pct.toFixed(1)}%) — surplus caloric moderat.` };
      // interval optim: +0.25% … +0.5%
      if (pct <= 0.75) return { adj: -100, reason: `Creștere ușor prea rapidă (${pct.toFixed(1)}%) — reducere mică de calorii.` };
      if (pct <= 1.0)  return { adj: -150, reason: `Creștere rapidă (${pct.toFixed(1)}%) — reducere moderată pentru a controla grăsimea.` };
      return              { adj: -200, reason: `Creștere excesivă (${pct.toFixed(1)}%) — reducere semnificativă.` };
    }

    if (goal === 'maintenance') {
      // interval optim: ±0.3%
      if (pct >= 1.0)  return { adj: -225, reason: `Creștere rapidă (+${pct.toFixed(1)}%) pe menținere.` };
      if (pct >= 0.5)  return { adj: -175, reason: `Creștere moderată (+${pct.toFixed(1)}%) pe menținere.` };
      if (pct >= 0.3)  return { adj: -100, reason: `Ușoară creștere (+${pct.toFixed(1)}%) pe menținere.` };
      if (pct >= -0.3) return { adj:    0, reason: 'Greutate stabilă — planul funcționează perfect.' };
      if (pct >= -0.5) return { adj: +100, reason: `Ușoară scădere (${Math.abs(pct).toFixed(1)}%) pe menținere.` };
      if (pct >= -1.0) return { adj: +175, reason: `Scădere moderată (${Math.abs(pct).toFixed(1)}%) pe menținere.` };
      return              { adj: +225, reason: `Scădere rapidă (${Math.abs(pct).toFixed(1)}%) pe menținere.` };
    }

    return { adj: 0, reason: 'Obiectiv necunoscut — fără ajustare.' };
  }, []);

  // Memoized AI recommendation computation
  const computeAiRecommendation = useCallback((data, stagnationWeeks, client, nutritionalNeeds, weightHistory, previousPlanCalories) => {
    const goal = client?.goal || 'maintenance';
    const adherence = data.respectare?.toLowerCase();
    const energy = data.energie?.toLowerCase();
    const hunger = data.foame?.toLowerCase();

    const currentCal = previousPlanCalories || nutritionalNeeds?.calories || null;

    let action = 'continue';
    let calChange = 0;
    let reason = '';

    // ─── Calculează schimbarea de greutate față de intrarea anterioară [CLIENT] ─
    let weightChangePercent = 0;
    const currentWeight = parseFloat(data.weight);
    let previousWeight = null;

    const clientEntries = (weightHistory?.filter(e => e.notes?.startsWith('[CLIENT]')) || [])
      .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));

    if (clientEntries.length >= 2) {
      previousWeight = parseFloat(clientEntries[1].weight);
    } else if (clientEntries.length === 1 && client?.weight) {
      previousWeight = parseFloat(client.weight);
    }

    if (previousWeight && currentWeight && Math.abs(currentWeight - previousWeight) > 0.05) {
      weightChangePercent = ((currentWeight - previousWeight) / previousWeight) * 100;
    }

    // Săptămâna de cut = numărul de intrări [CLIENT] deja existente + 1 (cea curentă)
    const needsWeekNum = goal === 'weight_loss' || goal === 'muscle_gain';
    const weekNumber = needsWeekNum ? (clientEntries.length + 1) : 99;
    const isEarlyCut  = goal === 'weight_loss'  && weekNumber <= 2;
    const isEarlyBulk = goal === 'muscle_gain' && weekNumber <= 2;

    // ─── Ajustare bazată pe greutate (trepte proporționale) ─────────────────
    const { adj: weightAdj, reason: weightReason } = calcWeightBasedAdjustment(goal, weightChangePercent, weekNumber);

    // Verifică dacă suntem în intervalul optim
    const isOptimalWeight = (() => {
      if (goal === 'weight_loss') {
        const minLoss = isEarlyCut ? -2.5 : -1.0;
        return weightChangePercent >= minLoss && weightChangePercent <= -0.2;
      }
      if (goal === 'muscle_gain') {
        const maxGain = isEarlyBulk ? 1.5 : 0.5;
        return weightChangePercent >= 0.25 && weightChangePercent <= maxGain;
      }
      if (goal === 'maintenance') return Math.abs(weightChangePercent) <= 0.3;
      return false;
    })();

    // ─── Ajustare foame (se cumulează) ───────────────────────────────────────
    let hungerAdj = 0;
    let hungerReason = '';
    if (hunger === 'extrem' || (hunger === 'crescut' && energy === 'scazut')) {
      hungerAdj = 100;
      hungerReason = hunger === 'extrem'
        ? 'Foame extremă — deficit prea agresiv.'
        : 'Foame crescută + energie scăzută — necesită ajustare.';
    }

    // ─── Ajustare stagnare (înlocuiește greutatea dacă e mai mare în magnitudine) ─
    let stagnationAdj = 0;
    let stagnationReason = '';
    const isWeightStable = Math.abs(weightChangePercent) < 0.3;
    if (stagnationWeeks >= 2 && isWeightStable) {
      if (goal === 'weight_loss')  { stagnationAdj = -175; stagnationReason = `Stagnare ${stagnationWeeks} săptămâni pe cut — reducere deficit.`; }
      if (goal === 'muscle_gain') { stagnationAdj = +175; stagnationReason = `Stagnare ${stagnationWeeks} săptămâni pe masă — creștere surplus.`; }
    }

    const hasSpecialCase = hungerAdj !== 0 || stagnationAdj !== 0;

    if (!isOptimalWeight || hasSpecialCase) {
      action = 'regenerate';

      // Calculează ajustarea finală (aceeași logică ca în route.js)
      let finalAdj = weightAdj;
      if (hungerAdj > 0) finalAdj += hungerAdj;
      if (stagnationAdj !== 0 && Math.abs(weightAdj) < Math.abs(stagnationAdj)) {
        finalAdj = stagnationAdj + (hungerAdj || 0);
      }

      calChange = finalAdj;

      // ─── CAP ±350 kcal per sesiune (identic cu backend) ───
      const MAX_ADJ = 350;
      if (Math.abs(calChange) > MAX_ADJ) {
        calChange = calChange > 0 ? MAX_ADJ : -MAX_ADJ;
        reason = (reason || '') + ' Ajustare limitată la ±350 kcal per sesiune pentru siguranță.';
      }

      reason = [weightReason, hungerReason, stagnationReason].filter(Boolean).join(' ');

      // Dacă e optimal din greutate dar avem cazuri speciale, ajustăm mesajul
      if (isOptimalWeight) {
        reason = [hungerReason, stagnationReason].filter(Boolean).join(' ');
      }
    } else {
      // Interval optim, fără cazuri speciale
      if (stagnationWeeks === 1 && adherence === 'complet') {
        reason = 'O săptămână fără schimbare — este prea devreme pentru ajustare.';
      } else {
        reason = weightReason || 'Progres conform așteptărilor — planul funcționează.';
      }
    }

    const targetCal = currentCal ? currentCal + calChange : null;
    // Avertizare podea calorică (doar pentru afișare, backend-ul aplică floor-ul efectiv)
    const CALORIE_FLOOR = client?.gender === 'M' ? 1500 : 1300;
    const floorApplied = targetCal !== null && targetCal < CALORIE_FLOOR;
    const displayTargetCal = floorApplied ? CALORIE_FLOOR : targetCal;
    if (floorApplied) {
      reason = (reason || '') + ` Plan ajustat la minimul de siguranță de ${CALORIE_FLOOR} kcal — sub această valoare riscul de deficit nutritiv e ridicat.`;
    }
    return { action, calChange, reason, targetCal: displayTargetCal, currentCal, floorApplied };
  }, [calcWeightBasedAdjustment]); // depends on calcWeightBasedAdjustment

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

    const token = localStorage.getItem('token');

    // Șterge badge-ul din DB
    try {
      await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ has_new_progress: false }),
      });
    } catch (err) {
      console.error('[handleContinue] PATCH error:', err);
    }

    // Trimite notificare clientului că antrenorul a verificat progresul
    try {
      const notifRes = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          type: 'plan_continued',
          title: 'Progres verificat',
          message: 'Antrenorul tău ți-a verificat progresul. Continuă tot așa!',
          related_client_id: clientId,
          related_plan_id: planId || null,
        }),
      });
      if (!notifRes.ok) {
        const err = await notifRes.json().catch(() => ({}));
        console.error('[handleContinue] Notification failed:', err);
      }
    } catch (err) {
      console.error('[handleContinue] Notification error:', err);
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
