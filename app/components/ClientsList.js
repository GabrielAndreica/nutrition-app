'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useRouter } from 'next/navigation';
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

export default function ClientsList({ noPadding = false, onViewPlan, onGeneratePlan, onViewProgress }) {
  const router = useRouter();

  const [clients,    setClients]    = useState([]);
  const [planMap,    setPlanMap]    = useState({});
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [total,      setTotal]      = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [page,            setPage]            = useState(1);
  const [search,          setSearch]          = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [modalOpen,     setModalOpen]     = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [form,          setForm]          = useState(EMPTY_FORM);
  const [saving,        setSaving]        = useState(false);
  const [formError,     setFormError]     = useState(null);

  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchClients = useCallback(async (pageNum, searchQuery, signal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: pageNum, limit: LIMIT });
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/clients?${params}`, { headers: authHeaders(), signal });
      if (signal?.aborted) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la incarcare');
      setClients(data.clients    || []);
      setPlanMap(data.plans      || {});
      setTotal(data.total        || 0);
      setTotalPages(data.totalPages || 0);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    const controller = new AbortController();
    fetchClients(page, debouncedSearch, controller.signal);
    return () => controller.abort();
  }, [page, debouncedSearch, fetchClients]);

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
    setEditingClient(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
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
    setModalOpen(true);
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

  const handleProgressContinue = () => {
    setClients(prev => prev.map(c =>
      c.id === progressModalClient.id ? { ...c, has_new_progress: false } : c
    ));
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
      router.push(`/generator-plan?clientId=${c.id}&fromProgress=true`);
    } catch (err) {
      setProgressModalError(err.message);
      setProgressModalSaving(false);
    }
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
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
        closeModal();
      } else {
        setSearch('');
        setDebouncedSearch('');
        setPage(1);
        setClients(prev => [data.client, ...prev].slice(0, LIMIT));
        setTotal(t => t + 1);
        closeModal();
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

  const goToPage = (newPage) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
              <button className={styles.searchClear} onClick={() => setSearch('')} aria-label="Sterge cautare">
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
                <button className={styles.clearSearchBtn} onClick={() => setSearch('')}>Sterge filtrul</button>
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
            {clients.map(client => (
              <div key={client.id} className={styles.clientCard}>
                <button className={styles.deleteIconBtn} onClick={() => setDeleteId(client.id)} aria-label="Sterge client">
                  <TrashIcon />
                </button>
                <div className={styles.clientCardHeader}>
                  <div className={styles.clientInfo}>
                    <div className={styles.clientNameRow}>
                      <h3 className={styles.clientName}>{client.name}</h3>
                      {client.has_new_progress && (
                        <button 
                          className={styles.progressBadge} 
                          onClick={() => onViewProgress ? onViewProgress(client.id) : openProgressModal(client)}
                        >
                          Progres nou
                        </button>
                      )}
                    </div>
                    <p className={styles.clientMeta}>
                      {client.age} ani &middot; {client.weight} kg &middot; {client.height} cm
                    </p>
                  </div>
                </div>
                <div className={styles.clientTags}>
                  <span className={`${styles.tag} ${styles.tagGoal}`}>
                    {goalLabels[client.goal] || client.goal}
                  </span>
                  <span className={styles.tag}>{dietLabels[client.diet_type] || client.diet_type}</span>
                  <span className={styles.tag}>{client.meals_per_day} mese/zi</span>
                </div>
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
                  {planMap[client.id] ? (
                    <button className={styles.viewPlanBtn}
                      onClick={() => onViewPlan ? onViewPlan(planMap[client.id].planId) : router.push(`/meal-plan/${planMap[client.id].planId}`)}>
                      Vizualizeaza plan <ArrowIcon />
                    </button>
                  ) : (
                    <button className={styles.generateBtn}
                      onClick={() => onGeneratePlan ? onGeneratePlan(client.id) : router.push(`/generator-plan?clientId=${client.id}`)}>
                      Genereaza plan <ArrowIcon />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && totalPages > 1 && (
          <div className={styles.pagination}>
            <button className={styles.pageBtn} disabled={page === 1} onClick={() => goToPage(page - 1)}>
              Anterior
            </button>
            <span className={styles.pageInfo}>
              Pagina <strong>{page}</strong> din <strong>{totalPages}</strong>
              <span className={styles.pageDot}>·</span>
              {total} clienti
            </span>
            <button className={styles.pageBtn} disabled={page === totalPages} onClick={() => goToPage(page + 1)}>
              Urmator
            </button>
          </div>
        )}
      </div>
      )}

      {modalOpen && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{editingClient ? 'Editeaza client' : 'Client nou'}</h2>
              <button className={styles.modalClose} onClick={closeModal} aria-label="Inchide">x</button>
            </div>
            <form onSubmit={handleSave} className={styles.form}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Nume *</label>
                  <input name="name" value={form.name} onChange={handleFormChange} required placeholder="ex. Ion Popescu" />
                </div>
                <div className={styles.formGroup}>
                  <label>Gen</label>
                  <select name="gender" value={form.gender} onChange={handleFormChange}>
                    <option value="M">Masculin</option>
                    <option value="F">Feminin</option>
                  </select>
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Varsta *</label>
                  <input name="age" type="number" min="18" max="100" value={form.age} onChange={handleFormChange} required placeholder="ani" />
                </div>
                <div className={styles.formGroup}>
                  <label>Greutate (kg) *</label>
                  <input name="weight" type="number" step="0.1" min="30" max="300" value={form.weight} onChange={handleFormChange} required placeholder="kg" />
                </div>
                <div className={styles.formGroup}>
                  <label>Inaltime (cm) *</label>
                  <input name="height" type="number" min="100" max="250" value={form.height} onChange={handleFormChange} required placeholder="cm" />
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Obiectiv</label>
                  <select name="goal" value={form.goal} onChange={handleFormChange}>
                    <option value="weight_loss">Slabit</option>
                    <option value="muscle_gain">Masa musculara</option>
                    <option value="maintenance">Mentinere</option>
                    <option value="recomposition">Recompozitie</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Nivel activitate</label>
                  <select name="activityLevel" value={form.activityLevel} onChange={handleFormChange}>
                    <option value="sedentary">Sedentar</option>
                    <option value="light">Usor activ</option>
                    <option value="moderate">Moderat activ</option>
                    <option value="very_active">Foarte activ</option>
                  </select>
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Tip dieta</label>
                  <select name="dietType" value={form.dietType} onChange={handleFormChange}>
                    <option value="omnivore">Omnivor</option>
                    <option value="vegetarian">Vegetarian</option>
                    <option value="vegan">Vegan</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Mese pe zi</label>
                  <select name="mealsPerDay" value={form.mealsPerDay} onChange={handleFormChange}>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                  </select>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Alergii / intolerante</label>
                <input name="allergies" value={form.allergies} onChange={handleFormChange} placeholder="ex. gluten, lactate, nuci" />
              </div>
              <div className={styles.formGroup}>
                <label>Preferinte alimentare</label>
                <textarea
                  name="foodPreferences"
                  value={form.foodPreferences}
                  onChange={handleFormChange}
                  placeholder="ex. Imi place puiul, orezul, broccoliul. Prefer mancaruri simple. Nu imi plac ciupercile."
                  rows="3"
                  className={styles.textarea}
                />
              </div>
              {formError && <div className={styles.formError}>{formError}</div>}
              <div className={styles.modalFooter}>
                <button type="button" className={styles.cancelBtn} onClick={closeModal}>Anuleaza</button>
                <button type="submit" className={styles.saveBtn} disabled={saving}>
                  {saving ? <><span className={styles.savingSpinner} />Se salveaza...</> : editingClient ? 'Salveaza modificarile' : 'Adauga client'}
                </button>
              </div>
            </form>
          </div>
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
