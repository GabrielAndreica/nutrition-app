'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import styles from './clients.module.css';

const EMPTY_FORM = {
  name: '', age: '', weight: '', height: '',
  gender: 'M', goal: 'maintenance', activityLevel: 'moderate',
  dietType: 'omnivore', allergies: '', mealsPerDay: '3',
};

const goalLabels = {
  weight_loss: 'Slăbit', muscle_gain: 'Masă musculară',
  maintenance: 'Menținere', recomposition: 'Recompoziție',
};
const dietLabels = { omnivore: 'Omnivor', vegetarian: 'Vegetarian', vegan: 'Vegan' };
const activityLabels = {
  sedentary: 'Sedentar', light: 'Ușor activ',
  moderate: 'Moderat activ', very_active: 'Foarte activ',
};

function ClientsContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null); // null = add, object = edit
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  // Delete confirm
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Search
  const [search, setSearch] = useState('');

  // Plan map: { [clientId]: planId }
  const [clientPlanMap, setClientPlanMap] = useState({});

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
  }), []);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [clientsRes, plansRes] = await Promise.all([
        fetch('/api/clients', { headers: authHeaders() }),
        fetch('/api/meal-plans', { headers: authHeaders() }),
      ]);
      const clientsData = await clientsRes.json();
      const plansData = await plansRes.json();
      if (!clientsRes.ok) throw new Error(clientsData.error || 'Eroare la încărcare');
      setClients(clientsData.clients || []);
      setClientPlanMap(plansData.plans || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const openAdd = () => {
    setEditingClient(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (client) => {
    setEditingClient(client);
    setForm({
      name: client.name || '',
      age: String(client.age || ''),
      weight: String(client.weight || ''),
      height: String(client.height || ''),
      gender: client.gender || 'M',
      goal: client.goal || 'maintenance',
      activityLevel: client.activity_level || 'moderate',
      dietType: client.diet_type || 'omnivore',
      allergies: client.allergies || '',
      mealsPerDay: String(client.meals_per_day || '3'),
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
      const url = editingClient ? `/api/clients/${editingClient.id}` : '/api/clients';
      const method = editingClient ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la salvare');
      await fetchClients();
      closeModal();
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
      const res = await fetch(`/api/clients/${deleteId}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la ștergere');
      setClients(prev => prev.filter(c => c.id !== deleteId));
      setDeleteId(null);
    } catch (err) {
      setError(err.message);
      setDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  const filtered = clients.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.headerLeft}>
            <button className={styles.backBtn} onClick={() => router.push('/dashboard')}>← Înapoi</button>
            <h1>Clienți</h1>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {/* Search */}
        <div className={styles.toolbar}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Caută client..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <span className={styles.count}>{filtered.length} {filtered.length === 1 ? 'client' : 'clienți'}</span>
          <button className={styles.addBtn} onClick={openAdd}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span className={styles.addBtnLabel}>Adaugă client</span>
          </button>
        </div>

        {error && <div className={styles.error}>⚠️ {error}</div>}

        {/* Client list */}
        {loading ? (
          <div className={styles.emptyState}>Se încarcă...</div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            {search ? 'Niciun client găsit.' : 'Nu ai clienți încă. Apasă „+ Adaugă client" pentru a începe.'}
          </div>
        ) : (
          <div className={styles.clientGrid}>
            {filtered.map(client => (
              <div key={client.id} className={styles.clientCard}>
                <div className={styles.clientCardTop}>
                  <div className={styles.clientInfo}>
                    <h3 className={styles.clientName}>{client.name}</h3>
                    <p className={styles.clientMeta}>
                      {client.age} ani · {client.weight} kg · {client.height} cm
                    </p>
                  </div>
                </div>
                <div className={styles.clientTags}>
                  <span className={styles.tag}>{goalLabels[client.goal] || client.goal}</span>
                  <span className={styles.tag}>{dietLabels[client.diet_type] || client.diet_type}</span>
                  <span className={styles.tag}>{client.meals_per_day} mese/zi</span>
                </div>
                <div className={styles.clientActions}>
                  <button className={styles.editBtn} onClick={() => openEdit(client)}>Editează</button>
                  {clientPlanMap[client.id] ? (
                    <button
                      className={styles.viewPlanBtn}
                      onClick={() => router.push(`/meal-plan/${clientPlanMap[client.id].planId}`)}
                    >
                      Vizualizează plan
                    </button>
                  ) : (
                    <button
                      className={styles.generateBtn}
                      onClick={() => router.push(`/generator-plan?clientId=${client.id}`)}
                    >
                      Generează plan
                    </button>
                  )}
                  <button className={styles.deleteBtn} onClick={() => setDeleteId(client.id)}>Șterge</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{editingClient ? 'Editează client' : 'Client nou'}</h2>
              <button className={styles.modalClose} onClick={closeModal}>✕</button>
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
                  <label>Vârstă *</label>
                  <input name="age" type="number" min="18" max="100" value={form.age} onChange={handleFormChange} required placeholder="ani" />
                </div>
                <div className={styles.formGroup}>
                  <label>Greutate (kg) *</label>
                  <input name="weight" type="number" step="0.1" min="30" max="300" value={form.weight} onChange={handleFormChange} required placeholder="kg" />
                </div>
                <div className={styles.formGroup}>
                  <label>Înălțime (cm) *</label>
                  <input name="height" type="number" min="100" max="250" value={form.height} onChange={handleFormChange} required placeholder="cm" />
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Obiectiv</label>
                  <select name="goal" value={form.goal} onChange={handleFormChange}>
                    <option value="weight_loss">Slăbit</option>
                    <option value="muscle_gain">Masă musculară</option>
                    <option value="maintenance">Menținere</option>
                    <option value="recomposition">Recompoziție</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Nivel activitate</label>
                  <select name="activityLevel" value={form.activityLevel} onChange={handleFormChange}>
                    <option value="sedentary">Sedentar</option>
                    <option value="light">Ușor activ</option>
                    <option value="moderate">Moderat activ</option>
                    <option value="very_active">Foarte activ</option>
                  </select>
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Tip dietă</label>
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
                <label>Alergii / intoleranțe</label>
                <input name="allergies" value={form.allergies} onChange={handleFormChange} placeholder="ex. gluten, lactate, nuci" />
              </div>
              {formError && <div className={styles.formError}>⚠️ {formError}</div>}
              <div className={styles.modalFooter}>
                <button type="button" className={styles.cancelBtn} onClick={closeModal}>Anulează</button>
                <button type="submit" className={styles.saveBtn} disabled={saving}>
                  {saving ? 'Se salvează...' : editingClient ? 'Salvează' : 'Adaugă'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteId && (
        <div className={styles.modalOverlay} onClick={() => setDeleteId(null)}>
          <div className={styles.confirmModal} onClick={e => e.stopPropagation()}>
            <h3>Ștergi clientul?</h3>
            <p>Această acțiune este ireversibilă.</p>
            <div className={styles.confirmActions}>
              <button className={styles.cancelBtn} onClick={() => setDeleteId(null)}>Anulează</button>
              <button className={styles.deleteBtnConfirm} onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Se șterge...' : 'Șterge'}
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
