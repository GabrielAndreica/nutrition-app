'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './AddExerciseModal.module.css';

// ── Romanian labels for muscle groups ────────────────────────────────────────
const MUSCLE_GROUP_LABELS = {
  chest:      'Piept',
  back:       'Spate',
  shoulders:  'Umeri',
  arms:       'Brațe (Biceps & Triceps)',
  quads:      'Cvadriceps',
  hamstrings: 'Femurali',
  glutes:     'Fesieri',
  calves:     'Gambe',
  core:       'Abdomen & Core',
};

const MUSCLE_GROUP_ORDER = ['chest', 'back', 'shoulders', 'arms', 'quads', 'hamstrings', 'glutes', 'calves', 'core'];

const EQUIPMENT_LABELS = {
  barbell:    'Bară',
  dumbbell:   'Gantere',
  cable:      'Cablu',
  machine:    'Aparat',
  bodyweight: 'Greutate corp',
  ez_bar:     'Bară EZ',
};

export default function AddExerciseModal({ isOpen, onClose, onAdd }) {
  const [exercises, setExercises]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [search, setSearch]         = useState('');
  const [activeGroup, setActiveGroup] = useState(null);
  const searchRef = useRef(null);
  const hasFetched = useRef(false);

  // Fetch exercises once
  const fetchExercises = useCallback(async () => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/exercises', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la încărcare');
      setExercises(data.exercises || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchExercises();
      // Focus search after animation frame
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setSearch('');
      setActiveGroup(null);
    }
  }, [isOpen, fetchExercises]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const normalizedSearch = search.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Normalize diacritics from a string for comparison
  const normStr = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Filter and group
  const grouped = {};
  for (const ex of exercises) {
    const group = ex.muscle_group || 'other';
    if (!grouped[group]) grouped[group] = [];

    if (normalizedSearch) {
      const nameRo = normStr(ex.name_ro);
      const nameEn = normStr(ex.name);
      if (!nameRo.includes(normalizedSearch) && !nameEn.includes(normalizedSearch)) continue;
    }
    if (activeGroup && group !== activeGroup) continue;

    grouped[group].push(ex);
  }

  const orderedGroups = MUSCLE_GROUP_ORDER.filter(g => grouped[g]?.length > 0);
  // Append any unknown groups
  for (const g of Object.keys(grouped)) {
    if (!orderedGroups.includes(g) && grouped[g]?.length > 0) orderedGroups.push(g);
  }

  const totalVisible = orderedGroups.reduce((sum, g) => sum + grouped[g].length, 0);

  const handleAdd = (ex) => {
    onAdd({
      name: ex.name_ro || ex.name,
      sets: parseInt(ex.default_sets) || 3,
      reps: ex.default_reps || '10-12',
      restSeconds: ex.default_rest_seconds ?? 90,
      muscleGroup: MUSCLE_GROUP_LABELS[ex.muscle_group] || ex.muscle_group || '',
      notes: '',
    });
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Selectează exercițiu">

        {/* Header */}
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>Adaugă exercițiu</h3>
            <p className={styles.subtitle}>Selectează din biblioteca de exerciții</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Închide">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Search + group filters */}
        <div className={styles.controls}>
          <div className={styles.searchWrap}>
            <svg className={styles.searchIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={searchRef}
              type="text"
              className={styles.searchInput}
              placeholder="Caută exercițiu..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className={styles.clearSearch} onClick={() => setSearch('')} aria-label="Șterge căutare">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>

          {/* Group pills */}
          <div className={styles.groupPills}>
            <button
              className={`${styles.groupPill} ${!activeGroup ? styles.groupPillActive : ''}`}
              onClick={() => setActiveGroup(null)}
            >Toate</button>
            {MUSCLE_GROUP_ORDER.map(g => {
              const hasExercises = exercises.some(e => e.muscle_group === g);
              if (!hasExercises) return null;
              return (
                <button
                  key={g}
                  className={`${styles.groupPill} ${activeGroup === g ? styles.groupPillActive : ''}`}
                  onClick={() => setActiveGroup(prev => prev === g ? null : g)}
                >
                  {MUSCLE_GROUP_LABELS[g] || g}
                </button>
              );
            })}
          </div>
        </div>

        {/* Exercise list */}
        <div className={styles.list}>
          {loading && (
            <div className={styles.emptyState}>
              <span className={styles.spinner} />
              <p>Se încarcă exercițiile...</p>
            </div>
          )}

          {error && (
            <div className={styles.errorState}>
              <p>{error}</p>
              <button className={styles.retryBtn} onClick={() => { hasFetched.current = false; fetchExercises(); }}>Încearcă din nou</button>
            </div>
          )}

          {!loading && !error && totalVisible === 0 && (
            <div className={styles.emptyState}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <p>Niciun exercițiu găsit{normalizedSearch ? ` pentru "${search}"` : ''}.</p>
            </div>
          )}

          {!loading && !error && orderedGroups.map(group => (
            <div key={group} className={styles.group}>
              <div className={styles.exerciseList}>
                {grouped[group].map(ex => (
                  <button
                    key={ex.id}
                    className={styles.exerciseRow}
                    onClick={() => handleAdd(ex)}
                    type="button"
                  >
                    <div className={styles.exerciseInfo}>
                      <span className={styles.exerciseName}>{ex.name_ro || ex.name}</span>
                      <span className={styles.exerciseMeta}>
                        {EQUIPMENT_LABELS[ex.equipment] || ex.equipment}
                        {ex.default_sets && ex.default_reps && (
                          <> · {ex.default_sets} × {ex.default_reps}</>
                        )}
                      </span>
                    </div>
                    <div className={styles.exerciseRight}>
                      <svg className={styles.addIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
