'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from '../WorkoutPlanGenerator/AddExerciseModal.module.css';

const MEAL_TYPE_LABELS = {
  breakfast: 'Mic Dejun',
  lunch:     'Prânz',
  dinner:    'Cină',
  snack:     'Gustare',
};

const MEAL_TYPE_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];

export default function AddMealModal({ isOpen, onClose, onAdd }) {
  const [recipes, setRecipes]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [resolving, setResolving]   = useState(null); // recipeId being resolved
  const [error, setError]           = useState(null);
  const [search, setSearch]         = useState('');
  const [activeType, setActiveType] = useState(null);
  const searchRef  = useRef(null);
  const hasFetched = useRef(false);

  const fetchRecipes = useCallback(async () => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res   = await fetch('/api/recipes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la încărcare');
      setRecipes(data.recipes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchRecipes();
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setSearch('');
      setActiveType(null);
      setResolving(null);
    }
  }, [isOpen, fetchRecipes]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const normStr = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalizedSearch = normStr(search.trim());

  // Group + filter recipes
  const grouped = {};
  for (const r of recipes) {
    const type = r.meal_type || 'other';
    if (!grouped[type]) grouped[type] = [];
    if (normalizedSearch && !normStr(r.name).includes(normalizedSearch)) continue;
    if (activeType && type !== activeType) continue;
    grouped[type].push(r);
  }

  const orderedTypes = MEAL_TYPE_ORDER.filter(t => grouped[t]?.length > 0);
  const totalVisible = orderedTypes.reduce((s, t) => s + grouped[t].length, 0);

  const handlePick = async (recipe) => {
    if (resolving) return;
    setResolving(recipe.id);
    try {
      const token = localStorage.getItem('token');
      const res   = await fetch('/api/recipes/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ recipeId: recipe.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la rezolvare rețetă');
      onAdd(data.meal);
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setResolving(null);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Selectează rețetă"
      >
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>Adaugă masă</h3>
            <p className={styles.subtitle}>Selectează o rețetă din baza de date</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Închide">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Search + type filters */}
        <div className={styles.controls}>
          <div className={styles.searchWrap}>
            <svg className={styles.searchIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={searchRef}
              type="text"
              className={styles.searchInput}
              placeholder="Caută rețetă..."
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

          {/* Meal type pills */}
          <div className={styles.groupPills}>
            <button
              className={`${styles.groupPill} ${!activeType ? styles.groupPillActive : ''}`}
              onClick={() => setActiveType(null)}
            >Toate</button>
            {MEAL_TYPE_ORDER.map(t => {
              if (!recipes.some(r => r.meal_type === t)) return null;
              return (
                <button
                  key={t}
                  className={`${styles.groupPill} ${activeType === t ? styles.groupPillActive : ''}`}
                  onClick={() => setActiveType(prev => prev === t ? null : t)}
                >
                  {MEAL_TYPE_LABELS[t] || t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Recipe list */}
        <div className={styles.list}>
          {/* Rețetă goală — mereu vizibilă în top, ascunsă doar dacă search nu o conține */}
          {(!normalizedSearch || normStr('Rețetă nouă').includes(normalizedSearch)) && (
            <div className={styles.group} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <div className={styles.exerciseList}>
                <button
                  className={styles.exerciseRow}
                  onClick={() => {
                    const mealNumber = Math.floor(Math.random() * 9000) + 1000;
                    onAdd({
                      name:        'Masă nouă',
                      mealType:    'Masă nouă',
                      preparation: '',
                      foods:       [],
                      mealTotals:  { calories: 0, protein: 0, carbs: 0, fat: 0 },
                    });
                    onClose();
                  }}
                  type="button"
                  disabled={!!resolving}
                >
                  <div className={styles.exerciseInfo}>
                    <span className={styles.exerciseName}>Rețetă nouă</span>
                    <span className={styles.exerciseMeta}>Masă goală — adaugă alimente manual</span>
                  </div>
                  <div className={styles.exerciseRight}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b7ff00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </div>
                </button>
              </div>
            </div>
          )}

          {loading && (
            <div className={styles.emptyState}>
              <span className={styles.spinner} />
              <p>Se încarcă rețetele...</p>
            </div>
          )}

          {error && (
            <div className={styles.errorState}>
              <p>{error}</p>
              <button
                className={styles.retryBtn}
                onClick={() => { hasFetched.current = false; fetchRecipes(); }}
              >Încearcă din nou</button>
            </div>
          )}

          {!loading && !error && totalVisible === 0 && (
            <div className={styles.emptyState}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <p>Nicio rețetă găsită{normalizedSearch ? ` pentru "${search}"` : ''}.</p>
            </div>
          )}

          {!loading && !error && orderedTypes.map(type => (
            <div key={type} className={styles.group}>
              <div className={styles.exerciseList}>
                {grouped[type].map(recipe => {
                  const isLoading = resolving === recipe.id;
                  return (
                    <button
                      key={recipe.id}
                      className={styles.exerciseRow}
                      onClick={() => handlePick(recipe)}
                      type="button"
                      disabled={!!resolving}
                    >
                      <div className={styles.exerciseInfo}>
                        <span className={styles.exerciseName}>{recipe.name}</span>
                        <span className={styles.exerciseMeta}>
                          {MEAL_TYPE_LABELS[recipe.meal_type] || recipe.meal_type}
                          {recipe.protein_source && ` · ${recipe.protein_source}`}
                        </span>
                      </div>
                      <div className={styles.exerciseRight}>
                        {isLoading ? (
                          <span className={styles.spinner} style={{ width: 16, height: 16, borderWidth: 2 }} />
                        ) : (
                          <svg className={styles.addIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
