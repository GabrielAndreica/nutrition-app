'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import styles from '@/app/clients/clients.module.css';

export default function InlineProgressView({ clientId, onBack, onGeneratePlan }) {
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

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  }), []);

  // Calculează recomandarea AI pe baza datelor de progres
  const computeAiRecommendation = (data, stagnationWeeks, client, nutritionalNeeds) => {
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
  };

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

  return (
    <div className={styles.progressInlinePage}>
      {/* Navigare înapoi */}
      <button className={styles.progressInlineBack} onClick={onBack} aria-label="Înapoi">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {loading && (
        <div className={styles.progressInlineCard}>
          <div className={styles.progressSheetLoading}>
            <span className={styles.savingSpinner} />Se încarcă...
          </div>
        </div>
      )}

      {error && !loading && (
        <div className={styles.progressInlineCard}>
          <div className={styles.formError} style={{ margin: '20px' }}>{error}</div>
          <div className={styles.progressSheetFooter}>
            <button className={styles.cancelBtn} onClick={onBack}>Înapoi</button>
          </div>
        </div>
      )}

      {!loading && !error && client && (
        <>
          {/* Header client */}
          <div className={styles.progressInlineHeading}>
            <div className={styles.progressInlineHeadingLeft}>
              <div className={styles.progressInlineAvatar}>
                {client.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className={styles.progressInlineName}>{client.name}</h2>
                <p className={styles.progressInlineSub}>
                  {progressData
                    ? `Progres trimis pe ${new Date(progressData.recordedAt).toLocaleString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                    : 'Fișă progres client'}
                </p>
              </div>
            </div>
          </div>

          {/* Card principal */}
          <div className={styles.progressInlineCard}>
            {!progressData ? (
              <>
                <p className={styles.progressSheetEmpty}>Nu există progres trimis recent de acest client.</p>
                <div className={styles.progressSheetFooter}>
                  <button className={styles.cancelBtn} onClick={onBack}>Înapoi</button>
                </div>
              </>
            ) : (
              <>
                {/* ── Secțiunea 1: Feedback client ── */}
                <div className={styles.progressSheetSection}>
                  <p className={styles.progressSheetSectionTitle}>Feedback client</p>
                  <div className={styles.progressSheetRow}>
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

                {/* ── Secțiunea 2: Istoricul greutăților ── */}
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
                        const isClient = entry.notes?.startsWith('[CLIENT]');
                        return (
                          <div key={entry.id || idx} className={styles.progressSheetHistoryRow}>
                            <span className={styles.progressSheetHistoryDate}>
                              {new Date(entry.recorded_at).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' })}
                            </span>
                            <span className={styles.progressSheetHistoryWeight}>{entry.weight} kg</span>
                            {diff !== null && (
                              <span className={parseFloat(diff) < 0 ? styles.progressSheetDiffDown : parseFloat(diff) > 0 ? styles.progressSheetDiffUp : styles.progressSheetDiffNeutral}>
                                {parseFloat(diff) > 0 ? '+' : ''}{diff} kg
                              </span>
                            )}
                            {isClient && <span className={styles.weightHistoryClientBadge}>client</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Secțiunea 3: Recomandare AI ── */}
                {aiRec && (
                  <div className={aiRec.action === 'regenerate' ? styles.progressSheetAiRegen : styles.progressSheetAiContinue}>
                    <div className={styles.progressSheetAiTop}>
                      <span className={styles.progressSheetAiIcon}>
                        {aiRec.action === 'regenerate' ? '📊' : '✅'}
                      </span>
                      <div>
                        <p className={styles.progressSheetAiLabel}>
                          {aiRec.action === 'regenerate' ? 'Recomandare: plan nou' : 'Recomandare: continuă planul'}
                        </p>
                        <p className={styles.progressSheetAiReason}>{aiRec.reason}</p>
                      </div>
                    </div>
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
                          {aiRec.calChange > 0 ? '+' : ''}{aiRec.calChange} kcal
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {error && <div className={styles.formError} style={{ margin: '0 28px 16px' }}>{error}</div>}

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
