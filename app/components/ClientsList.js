'use client';

import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import styles from '@/app/clients/clients.module.css';

const LIMIT = 20;

const EMPTY_FORM = {
  name: '', age: '', weight: '', height: '',
  gender: 'M', goal: 'maintenance', activityLevel: 'moderate',
  dietType: 'omnivore', allergies: '', mealsPerDay: '3',
  foodPreferences: '',
};

const goalLabels = {
  weight_loss: 'Slabit', muscle_gain: 'Masa musculara',
  maintenance: 'Mentinere', recomposition: 'Recompozitie',
};
const dietLabels = { omnivore: 'Omnivor', vegetarian: 'Vegetarian', vegan: 'Vegan' };
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

// Format plan creation time
const formatPlanTime = (createdAt) => {
  const now = new Date();
  const then = new Date(createdAt);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return 'acum mai puțin de o oră';
  if (diffHours < 24) return `acum ${diffHours} ${diffHours === 1 ? 'oră' : 'ore'}`;
  if (diffDays === 1) return 'ieri';
  if (diffDays < 7) return `acum ${diffDays} zile`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `acum ${weeks} ${weeks === 1 ? 'săptămână' : 'săptămâni'}`;
  }
  const months = Math.floor(diffDays / 30);
  return `acum ${months} ${months === 1 ? 'lună' : 'luni'}`;
};

// Memoized skeleton card pentru performanță
const SkeletonCard = memo(function SkeletonCard() {
  return (
    <div className={styles.skeletonCard}>
      <div className={styles.skeletonHeader}>
        <div className={styles.skeletonAvatar} />
        <div className={styles.skeletonLines}>
          <div className={`${styles.skeletonLine} ${styles.skeletonLineLg}`} />
          <div className={`${styles.skeletonLine} ${styles.skeletonLineMd}`} />
        </div>
      </div>
      <div className={styles.skeletonTags}>
        <div className={`${styles.skeletonTag} ${styles.skeletonTagGoal}`} />
        <div className={styles.skeletonTag} />
        <div className={styles.skeletonTag} />
      </div>
      <div className={styles.skeletonFooter}>
        <div className={styles.skeletonBtn} />
        <div className={`${styles.skeletonBtn} ${styles.skeletonBtnPrimary}`} />
      </div>
    </div>
  );
});

// Memoized icons pentru performanță
const TrashIcon = memo(function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
});

const ArrowIcon = memo(function ArrowIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>
  );
});

const ClockIcon = memo(function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
});

const CheckIcon = memo(function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
});

export default function ClientsList({ noPadding = false, onViewPlan, onGeneratePlan, onViewProgress, onAddFormChange }) {
  const router = useRouter();

  const [clients,    setClients]    = useState([]);
  const [planMap,    setPlanMap]    = useState({});
  const [generatingClients, setGeneratingClients] = useState(new Set());
  const [justFinishedClients, setJustFinishedClients] = useState(new Set());
  const [generatingInitialized, setGeneratingInitialized] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error,      setError]      = useState(null);
  const [total,      setTotal]      = useState(0);
  const [hasMore,    setHasMore]    = useState(false);
  const sentinelRef = useRef(null);
  const pageRef     = useRef(1);  // ref pentru closures stale

  const [page,            setPage]            = useState(1);
  const [search,          setSearch]          = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Ţine pageRef sincronizat pentru folosire în closures
  useEffect(() => { pageRef.current = page; }, [page]);

  const [showAddForm,   setShowAddForm]   = useState(false);
  const [modalOpen,     setModalOpen]     = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [form,          setForm]          = useState(EMPTY_FORM);
  const [saving,        setSaving]        = useState(false);
  const [formError,     setFormError]     = useState(null);
  const [fieldErrors,   setFieldErrors]   = useState({});
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [confirmSave,   setConfirmSave]   = useState(false);

  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [generateConfirmClientId, setGenerateConfirmClientId] = useState(null);
  const [generatingBusyModal, setGeneratingBusyModal] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteClientId, setInviteClientId] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const [progressModalClient,    setProgressModalClient]    = useState(null);
  const [progressModalData,      setProgressModalData]      = useState(null);
  const [progressModalLoading,   setProgressModalLoading]   = useState(false);
  const [progressModalError,     setProgressModalError]     = useState(null);
  const [progressModalNewWeight,     setProgressModalNewWeight]     = useState('');
  const [progressModalSaving,        setProgressModalSaving]        = useState(false);
  const [progressModalWeightHistory, setProgressModalWeightHistory] = useState([]);
  const [progressModalStagnation,    setProgressModalStagnation]    = useState(0);
  const [progressModalNutritionalNeeds, setProgressModalNutritionalNeeds] = useState(null);

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  }), []);

  useEffect(() => {
    // ─── Optimizare: Debounce 150ms (mai rapid decât 300ms) ───────
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 150);
    return () => clearTimeout(t);
  }, [search]);

  // Silent refresh care păstrează toți clienții încărcați (pentru polling)
  const fetchClientsRange = useCallback(async (limit) => {
    try {
      const params = new URLSearchParams({ page: 1, limit });
      const res = await fetch(`/api/clients?${params}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setClients(data.clients || []);
      setPlanMap(data.plans || {});
      setTotal(data.total || 0);
      setHasMore((data.total || 0) > limit);
    } catch {}
  }, [authHeaders]);

  const fetchClients = useCallback(async (pageNum, searchQuery, silent = false) => {
    const isFirstPage = pageNum === 1;
    if (!silent) {
      if (isFirstPage) setLoading(true);
      else setLoadingMore(true);
    }
    setError(null);
    
    // ─── Optimizare: Timeout 8s pentru fetch ───────
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    try {
      const params = new URLSearchParams({ page: pageNum, limit: LIMIT });
      if (searchQuery) params.set('search', searchQuery);
      
      const res = await fetch(`/api/clients?${params}`, { 
        headers: authHeaders(), 
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (controller.signal.aborted) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la incarcare');
      
      const newClients = data.clients || [];
      const newPlans   = data.plans   || {};
      
      if (silent) {
        // Silent refresh: înlocuiește complet (sync cu serverul)
        setClients(newClients);
        setPlanMap(newPlans);
      } else if (isFirstPage) {
        setClients(newClients);
        setPlanMap(newPlans);
      } else {
        // Infinite scroll: append cu deduplicare după id
        setClients(prev => {
          const existingIds = new Set(prev.map(c => c.id));
          const unique = newClients.filter(c => !existingIds.has(c.id));
          return [...prev, ...unique];
        });
        setPlanMap(prev => ({ ...prev, ...newPlans }));
      }
      
      const fetchedTotal = data.total || 0;
      setTotal(fetchedTotal);
      setHasMore(pageNum * LIMIT < fetchedTotal);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        setError('Timeout la încărcarea clienților. Încearcă din nou.');
        return;
      }
      setError(err.message);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchClients(page, debouncedSearch);
  }, [page, debouncedSearch, fetchClients]);

  // Nota: nu folosim focus/visibilitychange - suprascriu clientii adaugati local

  // Infinite scroll: incarca urmatoarea pagina cand sentinelul e vizibil
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          setPage(prev => prev + 1);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore]);

  useEffect(() => {
    let previousGeneratingIds = new Set();
    let intervalRef = null;
    let pollCount = 0;
    const mountTime = Date.now();

    const checkGenerating = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const res = await fetch('/api/generation-status', {
          headers: { 'Authorization': `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          const generatingIds = new Set(data.generations?.map(g => g.client_id) || []);

          // Detectează când o generare s-a terminat
          const finishedIds = Array.from(previousGeneratingIds).filter(id => !generatingIds.has(id));
          if (finishedIds.length > 0) {
            // Protejează clienții finalizați de flash-ul "Fără plan" până vine planMap din DB
            setJustFinishedClients(prev => new Set([...prev, ...finishedIds]));
            // Fetch toţi clienţii încărcaţi curent (nu doar page 1)
            const loadedLimit = pageRef.current * LIMIT;
            fetchClientsRange(loadedLimit).then(() => {
              // Planul e acum în planMap — eliberează protecția
              setJustFinishedClients(prev => {
                const next = new Set(prev);
                finishedIds.forEach(id => next.delete(id));
                return next;
              });
            });
            setTimeout(() => fetchClientsRange(loadedLimit), 2000);
            // Notifică dashboard-ul să re-fetch notificări imediat
            window.dispatchEvent(new Event('generationFinished'));
          }

          previousGeneratingIds = generatingIds;
          setGeneratingClients(generatingIds);
          setGeneratingInitialized(true);

          // Dacă nu mai e nicio generare activă, oprește polling-ul (economisește resurse)
          // Așteptăm minim 10s de la mount înainte să oprim — acoperă latency API la start
          pollCount++;
          const elapsed = Date.now() - mountTime;
          if (generatingIds.size === 0 && intervalRef && elapsed > 10000) {
            clearInterval(intervalRef);
            intervalRef = null;
          }
        }
      } catch (error) {
        console.error('Error checking generation status:', error);
      }
    };

    // Prima verificare la mount + pornește polling imediat (se oprește singur dacă nu e nimic activ)
    const init = async () => {
      await checkGenerating();
      // Pornește întotdeauna polling-ul la mount — se oprește singur când generatingIds.size === 0
      if (!intervalRef) {
        intervalRef = setInterval(checkGenerating, 1500);
      }
    };

    init();

    // Listener: când se pornește o generare nouă (buton apăsat), repornește polling-ul
    const handleGenerationStarted = () => {
      if (!intervalRef) {
        intervalRef = setInterval(checkGenerating, 1500);
      }
    };
    window.addEventListener('generationStarted', handleGenerationStarted);

    return () => {
      if (intervalRef) clearInterval(intervalRef);
      window.removeEventListener('generationStarted', handleGenerationStarted);
    };
  }, [page, debouncedSearch, fetchClients]);

  // Polling 10s pentru has_new_progress — simplu și fiabil
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/clients/progress-status', { headers: authHeaders() });
        if (!res.ok) return;
        const { statuses } = await res.json();
        if (!statuses?.length) return;
        // Actualizează doar clienții unde has_new_progress s-a schimbat
        setClients(prev => {
          const map = Object.fromEntries(statuses.map(s => [s.id, s.has_new_progress]));
          let changed = false;
          const next = prev.map(c => {
            if (c.id in map && c.has_new_progress !== map[c.id]) {
              changed = true;
              return { ...c, has_new_progress: map[c.id] };
            }
            return c;
          });
          return changed ? next : prev;
        });
      } catch {}
    };

    const interval = setInterval(poll, 10000);
    // Rulează imediat la mount (după ce clienții s-au încărcat)
    const initial = setTimeout(poll, 2000);
    return () => { clearInterval(interval); clearTimeout(initial); };
  }, [authHeaders]);

  // Auto-open progress view when navigated from meal plan page
  useEffect(() => {
    if (loading || clients.length === 0) return;
    const storedId = sessionStorage.getItem('openProgressClientId');
    if (!storedId) return;
    const client = clients.find(c => String(c.id) === storedId);
    if (!client) return;
    sessionStorage.removeItem('openProgressClientId');
    openProgressModal(client);
  }, [loading, clients]); // eslint-disable-line react-hooks/exhaustive-deps

  const openAdd = () => {
    if (showAddForm) {
      setShowAddForm(false);
      setForm(EMPTY_FORM);
      setFormError(null);
      onAddFormChange?.(false);
      return;
    }
    setEditingClient(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowAddForm(true);
    onAddFormChange?.(true);
  };

  const closeAddForm = () => {
    setShowAddForm(false);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFieldErrors({});
    setFormSubmitted(false);
    setEditingClient(null);
    onAddFormChange?.(false);
  };

  const openEdit = (client) => {
    setEditingClient(client);
    setForm({
      name:          client.name           || '',
      age:           String(client.age     || ''),
      weight:        String(client.weight  || ''),
      height:        String(client.height  || ''),
      gender:        client.gender         || 'M',
      goal:          client.goal           || 'maintenance',
      activityLevel: client.activity_level || 'moderate',
      dietType:      client.diet_type      || 'omnivore',
      allergies:     client.allergies      || '',
      mealsPerDay:   String(client.meals_per_day || '3'),
      foodPreferences: client.food_preferences || '',
    });
    setFormError(null);
    setFieldErrors({});
    setFormSubmitted(false);
    setShowAddForm(true);
    onAddFormChange?.(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingClient(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const openInviteModal = (client) => {
    setInviteClientId(client.id);
    setInviteEmail(client.invitation_email || '');
    setInviteError(null);
    setInviteSuccess(false);
    setInviteModalOpen(true);
  };

  const closeInviteModal = () => {
    setInviteModalOpen(false);
    setInviteClientId(null);
    setInviteEmail('');
    setInviteError(null);
    setInviteSuccess(false);
  };

  const handleSendInvite = async (e) => {
    e.preventDefault();
    setInviteError(null);
    setInviting(true);
    try {
      const res = await fetch(`/api/clients/${inviteClientId}/invite`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ email: inviteEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error || 'Eroare la trimiterea invitatiei.');
        setInviting(false);
        return;
      }
      setInviteSuccess(true);
      setClients(prevClients =>
        prevClients.map(c =>
          c.id === inviteClientId
            ? { ...c, invitation_status: 'pending', invitation_email: inviteEmail }
            : c
        )
      );
      setTimeout(() => { closeInviteModal(); }, 2000);
    } catch (err) {
      console.error('Eroare la trimiterea invitatiei:', err);
      setInviteError('Eroare la trimiterea invitatiei.');
    } finally {
      setInviting(false);
    }
  };

  // Calculează recomandarea AI pe baza datelor de progres
  const computeAiRecommendation = (data, stagnationWeeks, client, nutritionalNeeds) => {
    const goal = client?.goal || 'maintenance';
    const adherence = data.respectare?.toLowerCase();
    const energy    = data.energie?.toLowerCase();
    const hunger    = data.foame?.toLowerCase();
    const currentCal = nutritionalNeeds?.calories || null;

    let action = 'continue'; // 'continue' | 'regenerate'
    let calChange = 0;       // kcal delta
    let reason = '';

    // --- Foame extremă sau energie scăzută → creşte calorii ---
    if (hunger === 'extrem' || (hunger === 'crescut' && energy === 'scazut')) {
      action = 'regenerate';
      calChange = goal === 'weight_loss' ? +100 : +150;
      reason = hunger === 'extrem'
        ? 'Foame extremă — deficit prea agresiv'
        : 'Foame crescută + energie scăzută — necesită ajustare';
    }
    // --- Stagnare 2+ săptămâni ---
    else if (stagnationWeeks >= 2) {
      action = 'regenerate';
      if (goal === 'weight_loss') {
        calChange = adherence === 'complet' ? -100 : -150;
        reason = `Stagnare ${stagnationWeeks} săptămâni — reducere deficit`;
      } else if (goal === 'muscle_gain') {
        calChange = +100;
        reason = `Stagnare ${stagnationWeeks} săptămâni — creştere surplus`;
      } else {
        calChange = 0;
        reason = `Stagnare ${stagnationWeeks} săptămâni — reechilibrare macronutrienți`;
      }
    }
    // --- Stagnare 1 săptămână ---
    else if (stagnationWeeks === 1 && adherence === 'complet') {
      action = 'continue';
      reason = 'O săptămână fără schimbare — este prea devreme pentru ajustare';
    }
    // --- Totul bine ---
    else {
      action = 'continue';
      reason = 'Progres conform aşteptărilor — plană funcționează';
    }

    const targetCal = currentCal ? currentCal + calChange : null;
    return { action, calChange, reason, targetCal, currentCal };
  };

  const openProgressModal = async (client) => {
    setProgressModalClient(client);
    setProgressModalData(null);
    setProgressModalWeightHistory([]);
    setProgressModalStagnation(0);
    setProgressModalNutritionalNeeds(null);
    setProgressModalLoading(true);
    setProgressModalError(null);
    setProgressModalNewWeight('');
    try {
      // Fetch weight history + current plan daily_targets in parallel
      const planId = planMap[client.id]?.planId;
      const [whRes, planRes] = await Promise.all([
        fetch(`/api/clients/${client.id}/weight-history`, { headers: authHeaders() }),
        planId ? fetch(`/api/meal-plans/${planId}`, { headers: authHeaders() }) : Promise.resolve(null),
      ]);
      const whData = await whRes.json();
      if (!whRes.ok) throw new Error(whData.error || 'Eroare la incarcare');
      setProgressModalWeightHistory(whData.weightHistory || []);
      setProgressModalStagnation(whData.stagnationWeeks || 0);
      if (planRes?.ok) {
        const planData = await planRes.json();
        if (planData.mealPlan?.daily_targets) {
          setProgressModalNutritionalNeeds(planData.mealPlan.daily_targets);
        }
      }
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
        setProgressModalData({
          weight:     clientEntry.weight,
          recordedAt: clientEntry.recorded_at,
          respectare: parsed['Respectare'] || '-',
          energie:    parsed['Energie']    || '-',
          foame:      parsed['Foame']      || '-',
          mesaj:      parsed['Mesaj']      || '',
        });
        setProgressModalNewWeight(String(clientEntry.weight));
      }
    } catch (err) {
      setProgressModalError(err.message);
    } finally {
      setProgressModalLoading(false);
    }
  };

  const closeProgressModal = () => {
    setProgressModalClient(null);
    setProgressModalData(null);
    setProgressModalWeightHistory([]);
    setProgressModalStagnation(0);
    setProgressModalNutritionalNeeds(null);
    setProgressModalNewWeight('');
    setProgressModalError(null);
    setProgressModalSaving(false);
  };

  const handleProgressContinue = async () => {
    const clientId = progressModalClient?.id;
    // Optimistic update imediat
    setClients(prev => prev.map(c =>
      c.id === clientId ? { ...c, has_new_progress: false } : c
    ));
    // Persist în DB Înainte de a închide modalul — evită race condition cu re-fetch
    if (clientId) {
      try {
        const res = await fetch(`/api/clients/${clientId}`, {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify({ has_new_progress: false }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error('[handleProgressContinue] PATCH failed:', res.status, json);
        } else {
          console.log('[handleProgressContinue] PATCH ok, updated:', json.updated);
        }
      } catch (err) {
        console.error('[handleProgressContinue] PATCH error:', err);
      }
    }
    closeProgressModal();
  };

  const handleProgressGenerate = async () => {
    if (!progressModalClient || !progressModalData) return;
    setProgressModalSaving(true);
    const c = progressModalClient;
    const newWeight = parseFloat(progressModalNewWeight);
    const hasNewWeight = progressModalNewWeight.trim() !== '' && !isNaN(newWeight) && newWeight >= 30 && newWeight <= 300;

    try {
      if (hasNewWeight) {
        const res = await fetch(`/api/clients/${c.id}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({
            name: c.name, age: String(c.age), weight: String(newWeight),
            height: String(c.height), gender: c.gender, goal: c.goal,
            activityLevel: c.activity_level, dietType: c.diet_type,
            allergies: c.allergies || '', mealsPerDay: String(c.meals_per_day),
            foodPreferences: c.food_preferences || '',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Eroare la actualizare');
        setClients(prev => prev.map(cl =>
          cl.id === c.id ? { ...data.client, has_new_progress: false } : cl
        ));
      } else {
        setClients(prev => prev.map(cl =>
          cl.id === c.id ? { ...cl, has_new_progress: false } : cl
        ));
      }
      // Persist has_new_progress=false in DB so polling doesn't restore the badge
      fetch(`/api/clients/${c.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ has_new_progress: false }),
      }).catch(() => {});

      // Stochează datele de progres pentru generator
      sessionStorage.setItem('clientProgress', JSON.stringify({
        currentWeight: String(hasNewWeight ? newWeight : progressModalData.weight),
        adherence:     progressModalData.respectare,
        energyLevel:   progressModalData.energie,
        hungerLevel:   progressModalData.foame,
        notes:         progressModalData.mesaj || '',
        weeksNoChange: String(progressModalStagnation),
      }));

      // Stochează necesarul nutrițional curent pentru diff-ul macro după generare
      const planId = planMap[c.id]?.planId;
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

      setProgressModalClient(null);
      setProgressModalData(null);
      setProgressModalWeightHistory([]);
      setProgressModalStagnation(0);
      setProgressModalNewWeight('');
      setProgressModalSaving(false);
      if (onGeneratePlan) {
        onGeneratePlan(c.id, true);
      }
    } catch (err) {
      setProgressModalError(err.message);
      setProgressModalSaving(false);
    }
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) setFieldErrors(prev => ({ ...prev, [name]: null }));
  };

  const validateClientForm = (f) => {
    const errs = {};
    if (!f.name?.trim()) errs.name = 'Numele este obligatoriu';
    if (!f.age || isNaN(f.age) || f.age < 18 || f.age > 100) errs.age = 'Vârsta trebuie să fie între 18 și 100';
    if (!f.weight || isNaN(f.weight) || f.weight < 30 || f.weight > 300) errs.weight = 'Greutatea trebuie să fie între 30 și 300 kg';
    if (!f.height || isNaN(f.height) || f.height < 100 || f.height > 250) errs.height = 'Înălțimea trebuie să fie între 100 și 250 cm';
    return errs;
  };

  const handleSave = (e) => {
    e.preventDefault();
    setFormSubmitted(true);
    if (!editingClient) {
      const errs = validateClientForm(form);
      setFieldErrors(errs);
      if (Object.keys(errs).length > 0) return;
    }
    setConfirmSave(true);
  };

  const doSave = async () => {
    setConfirmSave(false);
    setSaving(true);
    setFormError(null);
    try {
      const url    = editingClient ? `/api/clients/${editingClient.id}` : '/api/clients';
      const method = editingClient ? 'PUT' : 'POST';
      const res    = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(form) });
      const data   = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la salvare');
      if (editingClient) {
        setClients(prev => prev.map(c => c.id === editingClient.id ? data.client : c));
        closeAddForm();
      } else {
        setSearch('');
        setDebouncedSearch('');
        setPage(1);
        setClients(prev => [data.client, ...prev].slice(0, LIMIT));
        setTotal(t => t + 1);
        closeAddForm();
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res  = await fetch(`/api/clients/${deleteId}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la stergere');
      setClients(prev => prev.filter(c => c.id !== deleteId));
      setTotal(t => Math.max(0, t - 1));
      setDeleteId(null);
    } catch (err) {
      setError(err.message);
      setDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleGenerateConfirm = async () => {
    if (!generateConfirmClientId) return;
    setGenerating(true);
    try {
      if (onGeneratePlan) {
        await onGeneratePlan(generateConfirmClientId);
      }
      // Repornește polling-ul de generare
      window.dispatchEvent(new Event('generationStarted'));
      setGenerateConfirmClientId(null);
    } catch (err) {
      console.error('Eroare la generarea planului:', err);
      setGenerateConfirmClientId(null);
    } finally {
      setGenerating(false);
    }
  };

  if (showAddForm) {
    return (
      <div className={styles.addPage}>

        <div className={styles.addPageNav}>
          <button className={styles.addFormBackBtn} onClick={closeAddForm} aria-label="Inapoi">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span className={styles.addPageTitle}>{editingClient ? `Editează client — ${editingClient.name}` : 'Client nou'}</span>
        </div>

        <form onSubmit={handleSave} className={styles.addPageForm} noValidate>

          {/* 01 Informații personale */}
          <div className={styles.addSection}>
            <div className={styles.addSectionHeader}>
              <span className={styles.addSectionNum}>01</span>
              <span className={styles.addSectionTitle}>Informații personale</span>
            </div>

            <div className={styles.addField}>
              <label>Nume complet *</label>
              <input name="name" value={form.name} onChange={handleFormChange}
                placeholder="ex. Ion Popescu" autoFocus
                className={formSubmitted && fieldErrors.name ? styles.addFieldErrorInput : ''} />
            </div>

            <div className={styles.addField}>
              <label>Gen</label>
              <div className={styles.seg}>
                {['M','F'].map(g => (
                  <button key={g} type="button"
                    className={`${styles.segBtn} ${form.gender === g ? styles.segOn : ''}`}
                    onClick={() => setForm(p => ({ ...p, gender: g }))}>
                    {g === 'M' ? 'Masculin' : 'Feminin'}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.addRow3}>
              <div className={styles.addField}>
                <label>Vârstă *</label>
                <div className={styles.inputUnit}>
                  <input name="age" type="number" min="18" max="100"
                    value={form.age} onChange={handleFormChange} placeholder="25"
                    className={formSubmitted && fieldErrors.age ? styles.addFieldErrorInput : ''} />
                  <span>ani</span>
                </div>
              </div>
              <div className={styles.addField}>
                <label>Greutate *</label>
                <div className={styles.inputUnit}>
                  <input name="weight" type="number" step="0.1" min="30" max="300"
                    value={form.weight} onChange={handleFormChange} placeholder="75"
                    className={formSubmitted && fieldErrors.weight ? styles.addFieldErrorInput : ''} />
                  <span>kg</span>
                </div>
              </div>
              <div className={styles.addField}>
                <label>Înălțime *</label>
                <div className={styles.inputUnit}>
                  <input name="height" type="number" min="100" max="250"
                    value={form.height} onChange={handleFormChange} placeholder="175"
                    className={formSubmitted && fieldErrors.height ? styles.addFieldErrorInput : ''} />
                  <span>cm</span>
                </div>
              </div>
            </div>
          </div>

          {/* 02 Obiective */}
          <div className={styles.addSection}>
            <div className={styles.addSectionHeader}>
              <span className={styles.addSectionNum}>02</span>
              <span className={styles.addSectionTitle}>Obiective și stil de viață</span>
            </div>

            <div className={styles.addField}>
              <label>Obiectiv principal</label>
              <div className={styles.goalGrid}>
                {[
                  { v: 'weight_loss', l: 'Slăbit' },
                  { v: 'muscle_gain', l: 'Masă musculară' },
                  { v: 'maintenance', l: 'Menținere' },
                ].map(({ v, l }) => (
                  <button key={v} type="button"
                    className={`${styles.goalCard} ${form.goal === v ? styles.goalOn : ''}`}
                    onClick={() => setForm(p => ({ ...p, goal: v }))}>
                    <span className={styles.goalL}>{l}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.addField}>
              <label>Nivel de activitate</label>
              <div className={styles.actGrid}>
                {[
                  { v: 'sedentary',   l: 'Sedentar',     sub: 'fără sport' },
                  { v: 'light',       l: 'Ușor activ',   sub: '1–2×/săpt' },
                  { v: 'moderate',    l: 'Moderat',       sub: '3–4×/săpt' },
                  { v: 'very_active', l: 'Foarte activ', sub: '5–6×/săpt' },
                ].map(({ v, l, sub }) => (
                  <button key={v} type="button"
                    className={`${styles.actCard} ${form.activityLevel === v ? styles.actOn : ''}`}
                    onClick={() => setForm(p => ({ ...p, activityLevel: v }))}>
                    <span className={styles.actL}>{l}</span>
                    <span className={styles.actSub}>{sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 03 Preferințe */}
          <div className={styles.addSection}>
            <div className={styles.addSectionHeader}>
              <span className={styles.addSectionNum}>03</span>
              <span className={styles.addSectionTitle}>Preferințe alimentare</span>
            </div>

            <div className={styles.addRow2}>
              <div className={styles.addField}>
                <label>Tip dietă</label>
                <div className={styles.seg}>
                  {[
                    { v: 'omnivore',   l: 'Omnivor' },
                    { v: 'vegetarian', l: 'Vegetarian' },
                    { v: 'vegan',      l: 'Vegan' },
                  ].map(({ v, l }) => (
                    <button key={v} type="button"
                      className={`${styles.segBtn} ${form.dietType === v ? styles.segOn : ''}`}
                      onClick={() => setForm(p => ({ ...p, dietType: v }))}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.addField}>
                <label>Mese pe zi</label>
                <div className={styles.seg}>
                  {['3','4','5'].map(n => (
                    <button key={n} type="button"
                      className={`${styles.segBtn} ${form.mealsPerDay === n ? styles.segOn : ''}`}
                      onClick={() => setForm(p => ({ ...p, mealsPerDay: n }))}>
                      {n} mese
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.addField}>
              <label>Alergii / intoleranțe</label>
              <input name="allergies" value={form.allergies} onChange={handleFormChange}
                placeholder="ex. gluten, lactate, nuci" />
            </div>

            <div className={styles.addField}>
              <label>Preferințe alimentare <span className={styles.opt}>(opțional)</span></label>
              <textarea name="foodPreferences" value={form.foodPreferences}
                onChange={handleFormChange} rows="2"
                placeholder="ex. Îmi place puiul. Nu îmi plac ciupercile."
              />
            </div>
          </div>

          {formError && <div className={styles.formError}>{formError}</div>}

          {confirmSave && (
            <div className={styles.modalOverlay} onClick={() => setConfirmSave(false)}>
              <div className={styles.confirmModal} onClick={e => e.stopPropagation()}>
                <div className={styles.confirmIcon}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
                <h3>{editingClient ? 'Salvezi modificările?' : 'Adaugi clientul?'}</h3>
                <p>{editingClient
                  ? `Datele lui ${editingClient.name} vor fi actualizate cu informațiile introduse.`
                  : `${form.name} va fi adăugat în lista ta de clienți.`}
                </p>
                <div className={styles.confirmActions}>
                  <button className={styles.cancelBtn} onClick={() => setConfirmSave(false)}>Anulează</button>
                  <button className={styles.saveBtn} onClick={doSave} disabled={saving}>
                    {saving ? 'Se salvează...' : editingClient ? 'Da, salvează' : 'Da, adaugă'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className={styles.addFooter}>
            <button type="submit" className={styles.saveBtn} disabled={saving}>
              {saving ? <><span className={styles.savingSpinner} />Se salvează...</> : editingClient ? 'Salvează modificările' : 'Adaugă client'}
            </button>
          </div>

        </form>
      </div>
    );
  }

  return (
    <>
      {!progressModalClient && (
      <div className={styles.content} style={noPadding ? { padding: 0 } : undefined}>

        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <svg className={styles.searchIcon} width="15" height="15" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Cauta dupa nume..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoComplete="off"
              spellCheck="false"
            />
            {search && (
              <button className={styles.searchClear} onClick={() => { setSearch(''); setLoading(true); }} aria-label="Sterge cautare">
                x
              </button>
            )}
          </div>
          <span className={styles.count}>
            {!loading && `${total} ${total === 1 ? 'client' : 'clienti'}`}
          </span>
          <button className={styles.addBtn} onClick={openAdd}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Adauga client
          </button>
        </div>

        {error && (
          <div className={styles.error}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {loading ? (
          <div className={styles.clientGrid}>
            {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : clients.length === 0 ? (
          <div className={styles.emptyState}>
            {search ? (
              <>
                <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <p>Niciun client gasit pentru <strong>"{search}"</strong></p>
                <button className={styles.clearSearchBtn} onClick={() => { setSearch(''); setLoading(true); }}>Sterge filtrul</button>
              </>
            ) : (
              <>
                <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <p>Nu ai clienti inca.</p>
                <button className={styles.addBtnEmpty} onClick={openAdd}>Adauga primul client</button>
              </>
            )}
          </div>
        ) : (
          <div className={styles.clientGrid}>
            {clients.map(client => {
              const hasAccount = !!client.user_id;
              const isPending = client.invitation_status === 'pending';
              const plan = planMap[client.id];
              const hasNewProgress = client.has_new_progress;
              const isGenerating = generatingClients.has(String(client.id));
              const isJustFinished = justFinishedClients.has(String(client.id));

              return (
              <div key={client.id} className={styles.clientCard}>
                <button className={styles.deleteIconBtn} onClick={() => setDeleteId(client.id)} aria-label="Sterge client">
                  <TrashIcon />
                </button>
                
                {/* Header cu nume */}
                <div className={styles.clientCardHeader}>
                  <div>
                    <h3 className={styles.clientName}>{client.name}</h3>
                    <div className={styles.badgeGroup}>
                      <span className={`${styles.accountBadge} ${hasAccount ? styles.badgeActive : (isPending ? styles.badgePending : styles.badgeInactive)}`}>
                        {hasAccount ? 'Activ' : (isPending ? 'Invitat' : 'Neinvitat')}
                      </span>
                      {isGenerating ? (
                        <span className={`${styles.accountBadge} ${styles.badgeGenerating}`}>
                          Se generează plan...
                        </span>
                      ) : !plan && generatingInitialized && !isJustFinished && (
                        <span className={`${styles.accountBadge} ${styles.badgeNoPlan}`}>
                          Fără plan alimentar
                        </span>
                      )}
                      {hasNewProgress && (
                        <span className={`${styles.accountBadge} ${styles.badgeProgress}`}>
                          Progres în așteptare
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Informații rapide */}
                <div className={styles.clientQuickInfo}>
                  {goalLabels[client.goal] || client.goal} · {client.weight}kg · {activityLabels[client.activity_level] || client.activity_level}
                </div>

                {/* Status plan */}
                <div className={styles.clientPlanStatus}>
                  {plan ? `Ultimul plan: ${formatPlanTime(plan.createdAt)}` : 'Nu există plan generat'}
                </div>

                {/* Butoane */}
                <div className={styles.clientActions}>
                  <div className={styles.secondaryActions}>
                    <button className={styles.editBtn} onClick={() => openEdit(client)}>Editeaza</button>
                    {!client.user_id && (
                      <button
                        className={client.invitation_status === 'pending' ? styles.inviteBtnPending : styles.inviteBtn}
                        onClick={() => openInviteModal(client)}
                        title={client.invitation_status === 'pending' ? `Trimisa la ${client.invitation_email}. Click pentru a retrimite.` : ''}
                      >
                        {client.invitation_status === 'pending' ? 'Retrimite' : 'Invitatie'}
                      </button>
                    )}
                  </div>
                  {plan || isGenerating ? (
                    <button className={styles.viewPlanBtn}
                      disabled={isGenerating}
                      style={isGenerating ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                      onClick={() => {
                        if (isGenerating) {
                          return; // Butonul e disabled, nu face nimic
                        } else {
                          onViewPlan && onViewPlan(planMap[client.id].planId);
                        }
                      }}>
                      Vizualizeaza plan <ArrowIcon />
                    </button>
                  ) : (
                    <button className={styles.generateBtn}
                      onClick={() => {
                        if (generatingClients.size > 0) {
                          setGeneratingBusyModal(true);
                        } else {
                          setGenerateConfirmClientId(client.id);
                        }
                      }}>
                      Genereaza plan <ArrowIcon />
                    </button>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        )}

        {/* Sentinel infinite scroll */}
        {!loading && <div ref={sentinelRef} style={{ height: 1 }} />}
        {loadingMore && (
          <div className={styles.loadingMore}>
            <div className={styles.loadingMoreSpinner} />
          </div>
        )}
      </div>
      )}

      {deleteId && (
        <div className={styles.modalOverlay} onClick={() => setDeleteId(null)}>
          <div className={styles.confirmModal} onClick={e => e.stopPropagation()}>
            <div className={styles.confirmIcon}><TrashIcon /></div>
            <h3>Stergi clientul?</h3>
            <p>Aceasta actiune este ireversibila. Planurile alimentare asociate vor fi sterse.</p>
            <div className={styles.confirmActions}>
              <button className={styles.cancelBtn} onClick={() => setDeleteId(null)}>Anuleaza</button>
              <button className={styles.deleteBtnConfirm} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Se sterge...' : 'Sterge definitiv'}
              </button>
            </div>
          </div>
        </div>
      )}

      {generatingBusyModal && (
        <div className={styles.modalOverlay} onClick={() => setGeneratingBusyModal(false)}>
          <div className={styles.confirmModal} onClick={e => e.stopPropagation()}>
            <div className={styles.confirmIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <h3>Plan în curs de generare</h3>
            <p>Există deja un plan alimentar care se generează. Așteptați să se termine înainte de a genera un plan nou.</p>
            <div className={styles.confirmActions}>
              <button className={styles.saveBtn} onClick={() => setGeneratingBusyModal(false)}>Am înțeles</button>
            </div>
          </div>
        </div>
      )}

      {generateConfirmClientId && (
        <div className={styles.modalOverlay} onClick={() => setGenerateConfirmClientId(null)}>
          <div className={styles.confirmModal} onClick={e => e.stopPropagation()}>
            <div className={styles.confirmIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </div>
            <h3>Generezi plan alimentar?</h3>
            <p>Se va genera un plan alimentar personalizat pentru acest client pe baza datelor completate.</p>
            <div className={styles.confirmActions}>
              <button className={styles.cancelBtn} onClick={() => setGenerateConfirmClientId(null)}>Anuleaza</button>
              <button className={styles.saveBtn} onClick={handleGenerateConfirm} disabled={generating}>
                {generating ? 'Se genereaza...' : 'Genereaza plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {inviteModalOpen && (
        <div className={styles.modalOverlay} onClick={closeInviteModal}>
          <div className={styles.inviteModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Trimite invitatie client</h2>
              <button className={styles.modalClose} onClick={closeInviteModal} aria-label="Inchide">x</button>
            </div>
            {inviteSuccess ? (
              <div className={styles.successBox}>
                <div className={styles.successIcon}>✓</div>
                <p className={styles.successText}>Invitatia a fost trimisa cu succes!</p>
                <p className={styles.successSubtext}>Clientul va primi un email cu linkul de activare.</p>
                <button className={styles.successBtn} onClick={closeInviteModal}>
                  Inchide
                </button>
              </div>
            ) : (
              <form onSubmit={handleSendInvite} className={styles.inviteForm}>
                <div className={styles.formGroup}>
                  <label>Adresa de email a clientului *</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    placeholder="client@exemplu.ro"
                    disabled={inviting}
                  />
                  <p className={styles.helperText}>
                    Clientul va primi un email cu un link de activare a contului.
                  </p>
                </div>
                {inviteError && <div className={styles.formError}>{inviteError}</div>}
                <div className={styles.modalFooter}>
                  <button type="button" className={styles.cancelBtn} onClick={closeInviteModal}>Anuleaza</button>
                  <button type="submit" className={styles.saveBtn} disabled={inviting}>
                    {inviting ? <><span className={styles.savingSpinner} />Se trimite...</> : 'Trimite invitatia'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {progressModalClient && (() => {
        const aiRec = progressModalData
          ? computeAiRecommendation(
              progressModalData,
              progressModalStagnation,
              progressModalClient,
              progressModalNutritionalNeeds
            )
          : null;

        return (
          <div className={styles.progressInlinePage}>
            {/* Navigare înapoi */}
            <button className={styles.progressInlineBack} onClick={closeProgressModal} aria-label="Înapoi la clienți">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            {/* Header client */}
            <div className={styles.progressInlineHeading}>
              <div className={styles.progressInlineHeadingLeft}>
                <div className={styles.progressInlineAvatar}>
                  {progressModalClient.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 className={styles.progressInlineName}>{progressModalClient.name}</h2>
                  <p className={styles.progressInlineSub}>
                    {progressModalData
                      ? `Progres trimis pe ${new Date(progressModalData.recordedAt).toLocaleString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                      : 'Fișă progres client'}
                  </p>
                </div>
              </div>
            </div>

            {/* Card principal */}
            <div className={styles.progressInlineCard}>
              {progressModalLoading ? (
                <div className={styles.progressSheetLoading}>
                  <span className={styles.savingSpinner} />Se încarcă...
                </div>
              ) : !progressModalData ? (
                <>
                  <p className={styles.progressSheetEmpty}>Nu există progres trimis recent de acest client.</p>
                  <div className={styles.progressSheetFooter}>
                    <button className={styles.cancelBtn} onClick={closeProgressModal}>Înapoi</button>
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
                        <span className={styles.progressSheetVal}>{progressModalData.weight} kg</span>
                      </div>
                      <div className={styles.progressSheetKv}>
                        <span className={styles.progressSheetKey}>Respectare plan</span>
                        <span className={`${styles.progressSheetVal} ${styles.progressSheetCapitalize}`}>{progressModalData.respectare}</span>
                      </div>
                      <div className={styles.progressSheetKv}>
                        <span className={styles.progressSheetKey}>Nivel energie</span>
                        <span className={`${styles.progressSheetVal} ${styles.progressSheetCapitalize}`}>{progressModalData.energie}</span>
                      </div>
                      <div className={styles.progressSheetKv}>
                        <span className={styles.progressSheetKey}>Nivel foame</span>
                        <span className={`${styles.progressSheetVal} ${styles.progressSheetCapitalize}`}>{progressModalData.foame}</span>
                      </div>
                    </div>
                    {progressModalData.mesaj && (
                      <div className={styles.progressSheetMessage}>
                        <span className={styles.progressSheetKey}>Mesaj</span>
                        <p className={styles.progressSheetMessageText}>{progressModalData.mesaj}</p>
                      </div>
                    )}
                  </div>

                  {/* ── Secțiunea 2: Istoricul greutăților ── */}
                  {progressModalWeightHistory.length > 0 && (
                    <div className={styles.progressSheetSection}>
                      <p className={styles.progressSheetSectionTitle}>
                        Ultimele {Math.min(5, progressModalWeightHistory.length)} greutăți
                      </p>
                      <div className={styles.progressSheetHistoryTable}>
                        {progressModalWeightHistory.slice(0, 5).map((entry, idx, arr) => {
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

                  {progressModalError && <div className={styles.formError} style={{ margin: '0 28px 16px' }}>{progressModalError}</div>}

                  <div className={styles.progressSheetFooter}>
                    <button className={styles.cancelBtn} onClick={handleProgressContinue} disabled={progressModalSaving}>
                      Continuă planul
                    </button>
                    <button className={styles.saveBtn} onClick={handleProgressGenerate} disabled={progressModalSaving}>
                      {progressModalSaving
                        ? <><span className={styles.savingSpinner} />Se pregătește...</>
                        : 'Generează plan nou'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
