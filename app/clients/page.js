'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import AppHeader from '@/app/components/AppHeader';
import styles from './clients.module.css';

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

function SkeletonCard() {
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
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>
  );
}

function ClientsContent() {
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

  const closeModal = () => { setModalOpen(false); setEditingClient(null); };
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
    <div className={styles.container}>
      <AppHeader title="Clienti" backHref="/dashboard" />

      <div className={styles.content}>

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
                    <h3 className={styles.clientName}>{client.name}</h3>
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
                  <button className={styles.editBtn} onClick={() => openEdit(client)}>Editeaza</button>
                  {planMap[client.id] ? (
                    <button className={styles.viewPlanBtn}
                      onClick={() => router.push(`/meal-plan/${planMap[client.id].planId}`)}>
                      Vizualizeaza plan <ArrowIcon />
                    </button>
                  ) : (
                    <button className={styles.generateBtn}
                      onClick={() => router.push(`/generator-plan?clientId=${client.id}`)}>
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
                <label>Preferințe alimentare</label>
                <textarea 
                  name="foodPreferences" 
                  value={form.foodPreferences} 
                  onChange={handleFormChange} 
                  placeholder="ex. Îmi place puiul, orezul, broccoliul. Prefer mâncăruri simple. Nu îmi plac ciupercile."
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
    </div>
  );
}

export default function ClientsPage() {
  return (
    <ProtectedRoute>
      <ClientsContent />
    </ProtectedRoute>
  );
}
