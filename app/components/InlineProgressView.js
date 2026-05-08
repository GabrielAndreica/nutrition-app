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

const normalizeMetricValue = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

const getMetricToneClass = (key, value) => {
  const normalized = normalizeMetricValue(value);
  if (!normalized || normalized === '-') return styles.progressMetricChipNeutral;

  if (key === 'Respectare plan alimentar' || key === 'Respectare plan antrenament') {
    if (normalized === 'complet') return styles.progressMetricChipGood;
    if (normalized === 'partial') return styles.progressMetricChipWarning;
    if (normalized === 'deloc') return styles.progressMetricChipBad;
  }

  if (key === 'Energie') {
    if (normalized === 'scazut') return styles.progressMetricChipBad;
    if (normalized === 'normal' || normalized === 'ridicat') return styles.progressMetricChipGood;
  }

  if (key === 'Nivel foame') {
    if (normalized === 'normal') return styles.progressMetricChipGood;
    if (normalized === 'crescut') return styles.progressMetricChipWarning;
    if (normalized === 'extrem') return styles.progressMetricChipBad;
  }

  if (key === 'Dificultate antrenament') {
    if (normalized === 'usor' || normalized === 'moderat') return styles.progressMetricChipGood;
    if (normalized === 'greu') return styles.progressMetricChipWarning;
  }

  if (key === 'Oboseală' || key === 'Febră musculară') {
    if (normalized === 'scazuta' || normalized === 'absenta') return styles.progressMetricChipGood;
    if (normalized === 'moderata') return styles.progressMetricChipWarning;
    if (normalized === 'ridicata' || normalized === 'intensa') return styles.progressMetricChipBad;
  }

  return styles.progressMetricChipNeutral;
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

    // Workout signals
    const generalFatigue = data.generalFatigue?.toLowerCase() || '';
    const doms = data.doms?.toLowerCase() || '';
    const workoutDifficulty = data.workoutDifficulty?.toLowerCase() || '';

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

    const needsWeekNum = goal === 'weight_loss' || goal === 'muscle_gain';
    const weekNumber = needsWeekNum ? (clientEntries.length + 1) : 99;
    const isEarlyCut  = goal === 'weight_loss'  && weekNumber <= 2;
    const isEarlyBulk = goal === 'muscle_gain' && weekNumber <= 2;

    const { adj: weightAdj, reason: weightReason } = calcWeightBasedAdjustment(goal, weightChangePercent, weekNumber);

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

    // ─── Ajustare foame ──────────────────────────────────────────────────────
    let hungerAdj = 0;
    let hungerReason = '';
    if (hunger === 'extrem' || (hunger === 'crescut' && energy === 'scazut')) {
      hungerAdj = 100;
      hungerReason = hunger === 'extrem'
        ? 'Foame extremă — deficit prea agresiv.'
        : 'Foame crescută + energie scăzută — necesită ajustare.';
    }

    // ─── Ajustare stagnare ───────────────────────────────────────────────────
    let stagnationAdj = 0;
    let stagnationReason = '';
    const isWeightStable = Math.abs(weightChangePercent) < 0.3;
    if (stagnationWeeks >= 2 && isWeightStable) {
      if (goal === 'weight_loss')  { stagnationAdj = -175; stagnationReason = `Stagnare ${stagnationWeeks} săptămâni pe cut — reducere deficit.`; }
      if (goal === 'muscle_gain') { stagnationAdj = +175; stagnationReason = `Stagnare ${stagnationWeeks} săptămâni pe masă — creștere surplus.`; }
    }

    // ─── Semnale antrenament ─────────────────────────────────────────────────
    const workoutReasons = [];
    const highFatigue = generalFatigue === 'ridicata' || generalFatigue === 'ridicată' || generalFatigue === 'extrem';
    const highDoms = doms === 'intens' || doms === 'sever';
    const tooHard = workoutDifficulty === 'prea greu' || workoutDifficulty === 'extrem';

    if (highFatigue) workoutReasons.push('Oboseală generală ridicată — recuperare insuficientă.');
    if (highDoms) workoutReasons.push('DOMS intens — volum de antrenament prea mare.');
    if (tooHard) workoutReasons.push('Antrenamentele prea grele — intensitate/volum de redus.');

    // Semnalele de antrenament rămân informative, dar recomandarea afișată este doar alimentară.
    const hasWorkoutIssues = workoutReasons.length > 0;
    const hasSpecialCase = hungerAdj !== 0 || stagnationAdj !== 0;

    if (!isOptimalWeight || hasSpecialCase) {
      action = 'regenerate';

      let finalAdj = weightAdj;
      if (hungerAdj > 0) finalAdj += hungerAdj;
      if (stagnationAdj !== 0 && Math.abs(weightAdj) < Math.abs(stagnationAdj)) {
        finalAdj = stagnationAdj + (hungerAdj || 0);
      }

      calChange = finalAdj;

      const MAX_ADJ = 350;
      if (Math.abs(calChange) > MAX_ADJ) {
        calChange = calChange > 0 ? MAX_ADJ : -MAX_ADJ;
      }

      reason = [weightReason, hungerReason, stagnationReason].filter(Boolean).join(' ');

      if (isOptimalWeight) {
        reason = [hungerReason, stagnationReason].filter(Boolean).join(' ');
      }
    } else {
      if (stagnationWeeks === 1 && adherence === 'complet') {
        reason = 'O săptămână fără schimbare — este prea devreme pentru ajustare.';
      } else {
        reason = weightReason || 'Progres conform așteptărilor — planul funcționează.';
      }
    }

    const targetCal = currentCal ? currentCal + calChange : null;
    const CALORIE_FLOOR = client?.gender === 'M' ? 1500 : 1300;
    const floorApplied = targetCal !== null && targetCal < CALORIE_FLOOR;
    const displayTargetCal = floorApplied ? CALORIE_FLOOR : targetCal;
    if (floorApplied) {
      reason = (reason || '') + ` Plan ajustat la minimul de siguranță de ${CALORIE_FLOOR} kcal.`;
    }
    const nutritionReason = [weightReason, hungerReason, stagnationReason].filter(Boolean).join(' ') || reason;
    const workoutRec = hasWorkoutIssues
      ? { action: 'adjust', reasons: workoutReasons }
      : { action: 'ok', reasons: [] };
    return { action, calChange, reason, nutritionReason, workoutRec, targetCal: displayTargetCal, currentCal, floorApplied, hasWorkoutIssues };
  }, [calcWeightBasedAdjustment]);

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
          // Split by || to separate nutrition and workout sections
          const sections = notesBody.split(' || ');
          const nutritionSection = sections[0] || '';
          const workoutSection = sections[1] || '';

          const parseSection = (str) => {
            const parsed = {};
            str.split(' | ').forEach(part => {
              const colonIdx = part.indexOf(': ');
              if (colonIdx !== -1) parsed[part.slice(0, colonIdx).trim()] = part.slice(colonIdx + 2).trim();
            });
            return parsed;
          };

          // Strip "Nutriție -" prefix
          const nutParsed = parseSection(nutritionSection.replace(/^Nutriție\s*-\s*/i, ''));
          // Strip "Antrenament -" prefix
          const wrkParsed = parseSection(workoutSection.replace(/^Antrenament\s*-\s*/i, ''));

          setProgressData({
            weight: clientEntry.weight,
            recordedAt: clientEntry.recorded_at,
            // Nutriție
            respectare: nutParsed['Respectare'] || '-',
            energie: nutParsed['Energie'] || '-',
            foame: nutParsed['Foame'] || '-',
            mesaj: nutParsed['Mesaj'] || '',
            // Antrenament
            workoutAdherence: wrkParsed['Respectare'] || '',
            workoutDifficulty: wrkParsed['Dificultate'] || '',
            doms: wrkParsed['DOMS'] || '',
            pump: wrkParsed['Pump'] || '',
            generalFatigue: wrkParsed['Oboseala'] || '',
            workoutNotes: wrkParsed['Note'] || '',
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

      const shouldKeepCurrentTargets =
        aiRecommendation?.action === 'continue' ||
        !aiRecommendation?.calChange;

      // Stochează datele de progres pentru generator
      sessionStorage.setItem('clientProgress', JSON.stringify({
        currentWeight: String(progressData.weight),
        adherence: progressData.respectare,
        energyLevel: progressData.energie,
        hungerLevel: progressData.foame,
        notes: progressData.mesaj || '',
        weeksNoChange: String(stagnationWeeks),
        forceRegenerate: true,
        keepCurrentTargets: shouldKeepCurrentTargets,
        calorieAdjustment: shouldKeepCurrentTargets ? 0 : (aiRecommendation?.calChange || 0),
        // Câmpuri antrenament
        workoutAdherence: progressData.workoutAdherence || '',
        workoutDifficulty: progressData.workoutDifficulty || '',
        doms: progressData.doms || '',
        pump: progressData.pump || '',
        generalFatigue: progressData.generalFatigue || '',
        workoutNotes: progressData.workoutNotes || '',
        hasWorkoutIssues: aiRecommendation?.hasWorkoutIssues || false,
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

  const aiRec = aiRecommendation;

  const handleBackToPlan = () => {
    if (planId) {
      onBack(planId);
    } else {
      onBack();
    }
  };

  return (
    <div className={viewStyles.content}>
      {/* Navigare înapoi */}
      <div className={viewStyles.navRow}>
        <button className={viewStyles.navBackBtn} onClick={handleBackToPlan} aria-label="Înapoi la plan">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
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
            <div className={styles.progressMetricsGrid}>
              {[1,2,3,4,5,6,7,8].map(i => (
                <div key={i} className={styles.progressMetricChip} style={{ opacity: 0.5 }}>
                  <div className={viewStyles.shimmer} style={{ width: '70px', height: '10px', borderRadius: '4px', marginBottom: '5px' }} />
                  <div className={viewStyles.shimmer} style={{ width: '50px', height: '14px', borderRadius: '4px' }} />
                </div>
              ))}
            </div>
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
            <button className={styles.backBtnAlt} onClick={() => onBack()}>Înapoi la clienți</button>
          </div>
        </div>
      )}

      {!loading && !error && client && (
        <>
          {/* Header client */}
          <div className={mealPlanStyles.clientHeader}>
            <div className={mealPlanStyles.clientHeaderLeft}>
              <div>
                <h2 className={mealPlanStyles.clientName}>{client.name}</h2>
                <p className={mealPlanStyles.clientSub}>
                  {client.goal && `${goalLabels[client.goal] || client.goal} · `}
                  {client.diet_type && `${dietLabels[client.diet_type] || client.diet_type}`}
                </p>
              </div>
            </div>
            <div className={mealPlanStyles.clientStats}>
              {client.activity_level && (
                <div className={mealPlanStyles.clientStat}>
                  <span className={mealPlanStyles.clientStatValue}>{activityLabels[client.activity_level] || client.activity_level}</span>
                  <span className={mealPlanStyles.clientStatLabel}>activitate</span>
                </div>
              )}
              {client.training_split && (
                <div className={mealPlanStyles.clientStat}>
                  <span className={mealPlanStyles.clientStatValue}>{client.training_split}</span>
                  <span className={mealPlanStyles.clientStatLabel}>split</span>
                </div>
              )}
              {client.workouts_per_week && (
                <div className={mealPlanStyles.clientStat}>
                  <span className={mealPlanStyles.clientStatValue}>{client.workouts_per_week}</span>
                  <span className={mealPlanStyles.clientStatLabel}>zile/săpt</span>
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
                {/* Chip-grid plat cu toate metricile */}
                <div className={styles.progressMetricsGrid}>
                  {[
                    { k: 'Greutate actuală', v: progressData.weight ? `${progressData.weight} kg` : '—' },
                    { k: 'Respectare plan alimentar', v: progressData.respectare || '—' },
                    { k: 'Energie', v: progressData.energie || '—' },
                    { k: 'Nivel foame', v: progressData.foame || '—' },
                    { k: 'Respectare plan antrenament', v: progressData.workoutAdherence || '—' },
                    { k: 'Dificultate antrenament', v: progressData.workoutDifficulty || '—' },
                    { k: 'Oboseală', v: progressData.generalFatigue || '—' },
                    { k: 'Febră musculară', v: progressData.doms || '—' },
                  ].map(({ k, v }) => (
                    <div key={k} className={`${styles.progressMetricChip} ${getMetricToneClass(k, v)}`}>
                      <span className={styles.progressMetricKey}>{k}</span>
                      <span className={styles.progressMetricVal}>{v}</span>
                    </div>
                  ))}
                </div>

                <div className={styles.progressDetailsGrid}>
                  {/* Observațiile clientului */}
                  <div className={styles.progressNotesRow}>
                    <div className={styles.progressNote}>
                      <span className={styles.progressNoteLabel}>Observații nutriție</span>
                      <p className={`${styles.progressNoteText} ${!progressData.mesaj ? styles.progressNoteEmpty : ''}`}>
                        {progressData.mesaj || 'Clientul nu a adăugat observații pentru alimentație.'}
                      </p>
                    </div>
                    <div className={styles.progressNote}>
                      <span className={styles.progressNoteLabel}>Observații antrenament</span>
                      <p className={`${styles.progressNoteText} ${!progressData.workoutNotes ? styles.progressNoteEmpty : ''}`}>
                        {progressData.workoutNotes || 'Clientul nu a adăugat observații pentru antrenament.'}
                      </p>
                    </div>
                  </div>

                  {/* Istoric greutăți — before/after + ultimele 3 */}
                  {weightHistory.length > 0 && (() => {
                    const latest = weightHistory[0];
                    const previous = weightHistory.length > 1 ? weightHistory[1] : null;
                    const diff = previous ? (parseFloat(latest.weight) - parseFloat(previous.weight)).toFixed(1) : null;
                    const diffNum = diff !== null ? parseFloat(diff) : null;
                    return (
                      <div className={styles.progressWeightBand}>
                        {/* Before / After */}
                        {previous && (
                          <div className={styles.progressBeforeAfter}>
                            <div className={styles.progressBeforeAfterItem}>
                              <span className={styles.progressBeforeAfterLabel}>Săptămâna trecută</span>
                              <span className={styles.progressBeforeAfterVal}>{previous.weight} kg</span>
                              <span className={styles.progressBeforeAfterDate}>
                                {new Date(previous.recorded_at).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })}
                              </span>
                            </div>
                            <div className={styles.progressBeforeAfterArrow}>
                              <span className={diffNum < 0 ? styles.progressSheetDiffDown : diffNum > 0 ? styles.progressSheetDiffUp : styles.progressSheetDiffNeutral}>
                                {diffNum > 0 ? '+' : ''}{diff} kg
                              </span>
                            </div>
                            <div className={styles.progressBeforeAfterItem}>
                              <span className={styles.progressBeforeAfterLabel}>Acum</span>
                              <span className={styles.progressBeforeAfterVal}>{latest.weight} kg</span>
                              <span className={styles.progressBeforeAfterDate}>
                                {new Date(latest.recorded_at).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })}
                              </span>
                            </div>
                          </div>
                        )}
                        {/* Ultimele 3 înregistrări */}
                        <span className={styles.progressWeightBandLabel}>Ultimele {Math.min(weightHistory.length, 3)} greutăți raportate</span>
                        <div className={styles.progressWeightBandEntries}>
                          {weightHistory.slice(0, 3).map((entry, idx, arr) => {
                            const d = idx < arr.length - 1
                              ? (entry.weight - arr[idx + 1].weight).toFixed(1)
                              : null;
                            return (
                              <div key={entry.id || idx} className={styles.progressWeightEntry}>
                                <span className={styles.progressWeightDate}>
                                  {new Date(entry.recorded_at).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })}
                                </span>
                                <span className={styles.progressWeightVal}>{entry.weight} kg</span>
                                {d !== null && (
                                  <span className={parseFloat(d) < 0 ? styles.progressSheetDiffDown : parseFloat(d) > 0 ? styles.progressSheetDiffUp : styles.progressSheetDiffNeutral}>
                                    {parseFloat(d) > 0 ? '+' : ''}{d}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Recomandare alimentară */}
                {aiRec && !planContinued && (
                  <div className={styles.progressAiRow}>
                    <div className={styles.progressAiBlock}>
                      <p className={styles.progressAiTag}>Plan alimentar</p>
                      <p className={styles.progressAiAction}>
                        {aiRec.action === 'regenerate' ? 'Generează plan nou' : 'Continuă planul actual'}
                      </p>
                      <p className={styles.progressAiReason}>{aiRec.nutritionReason}</p>
                      {aiRec.action === 'regenerate' && aiRec.calChange !== 0 && aiRec.targetCal && (
                        <div className={styles.progressAiCalRow}>
                          {aiRec.currentCal && <span className={styles.progressAiCalOld}>{aiRec.currentCal} kcal →</span>}
                          <span className={styles.progressAiCalNew}>{aiRec.targetCal} kcal</span>
                          <span className={aiRec.calChange < 0 ? styles.progressSheetDiffDown : styles.progressSheetDiffUp}>
                            {aiRec.calChange > 0 ? '+' : ''}{aiRec.calChange}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {error && <div className={styles.formError} style={{ margin: '0 20px 12px' }}>{error}</div>}

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
