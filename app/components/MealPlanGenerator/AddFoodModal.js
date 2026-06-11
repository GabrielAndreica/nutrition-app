'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './AddFoodModal.module.css';

const CATEGORY_LABELS = {
  meat:       'Carne',
  fish:       'Pește',
  eggs:       'Ouă',
  dairy:      'Lactate',
  grains:     'Cereale',
  starch:     'Amidon',
  legumes:    'Leguminoase',
  vegetables: 'Legume',
  fruits:     'Fructe',
  fats:       'Grăsimi',
  nuts:       'Nuci & Semințe',
  sauces:     'Sosuri',
  other:      'Altele',
};

const CATEGORY_ORDER = ['meat', 'fish', 'eggs', 'dairy', 'grains', 'starch', 'legumes', 'vegetables', 'fruits', 'fats', 'nuts', 'sauces', 'other'];

export default function AddFoodModal({ isOpen, onClose, onAdd }) {
  const [foods, setFoods]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [search, setSearch]       = useState('');
  const [activeCategory, setActiveCategory] = useState(null);
  const searchRef  = useRef(null);
  const hasFetched = useRef(false);

  const fetchFoods = useCallback(async () => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/foods', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la încărcare');
      setFoods(data.foods || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchFoods();
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setSearch('');
      setActiveCategory(null);
    }
  }, [isOpen, fetchFoods]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalizedSearch = norm(search.trim());

  // Filter and group by category
  const grouped = {};
  for (const food of foods) {
    const cat = food.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    if (normalizedSearch) {
      if (!norm(food.name).includes(normalizedSearch)) continue;
    }
    if (activeCategory && cat !== activeCategory) continue;
    grouped[cat].push(food);
  }

  const orderedCategories = CATEGORY_ORDER.filter(c => grouped[c]?.length > 0);
  for (const c of Object.keys(grouped)) {
    if (!orderedCategories.includes(c) && grouped[c]?.length > 0) orderedCategories.push(c);
  }

  const totalVisible = orderedCategories.reduce((sum, c) => sum + grouped[c].length, 0);

  const handleAdd = (food) => {
    const amount = 100;
    const factor = amount / 100;
    onAdd({
      name:          food.name,
      amount,
      unit:          'g',
      displayAmount: `${amount}g`,
      calories:      Math.round((food.calories_per_100g || 0) * factor),
      protein:       Math.round((food.protein_per_100g || 0) * factor * 10) / 10,
      carbs:         Math.round((food.carbs_per_100g || 0) * factor * 10) / 10,
      fat:           Math.round((food.fat_per_100g || 0) * factor * 10) / 10,
      // Store per-100g values for recalculation when amount changes
      _per100g: {
        calories: food.calories_per_100g || 0,
        protein:  food.protein_per_100g  || 0,
        carbs:    food.carbs_per_100g    || 0,
        fat:      food.fat_per_100g      || 0,
      },
    });
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Adaugă aliment">

        {/* Header */}
        <div className={styles.header}>
          <div>
            <h3 className={styles.title}>Adaugă aliment</h3>
            <p className={styles.subtitle}>Selectează din baza de date de alimente</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Închide">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Search + category pills */}
        <div className={styles.controls}>
          <div className={styles.searchWrap}>
            <svg className={styles.searchIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={searchRef}
              type="text"
              className={styles.searchInput}
              placeholder="Caută aliment..."
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

          <div className={styles.categoryPills}>
            <button
              className={`${styles.categoryPill} ${!activeCategory ? styles.categoryPillActive : ''}`}
              onClick={() => setActiveCategory(null)}
            >Toate</button>
            {CATEGORY_ORDER.map(c => {
              if (!foods.some(f => f.category === c)) return null;
              return (
                <button
                  key={c}
                  className={`${styles.categoryPill} ${activeCategory === c ? styles.categoryPillActive : ''}`}
                  onClick={() => setActiveCategory(prev => prev === c ? null : c)}
                >
                  {CATEGORY_LABELS[c] || c}
                </button>
              );
            })}
          </div>
        </div>

        {/* Food list */}
        <div className={styles.list}>
          {loading && (
            <div className={styles.emptyState}>
              <span className={styles.spinner} />
              <p>Se încarcă alimentele...</p>
            </div>
          )}

          {error && (
            <div className={styles.errorState}>
              <p>{error}</p>
              <button className={styles.retryBtn} onClick={() => { hasFetched.current = false; fetchFoods(); }}>Încearcă din nou</button>
            </div>
          )}

          {!loading && !error && totalVisible === 0 && (
            <div className={styles.emptyState}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <p>Niciun aliment găsit{normalizedSearch ? ` pentru "${search}"` : ''}.</p>
            </div>
          )}

          {!loading && !error && orderedCategories.map(cat => (
            <div key={cat} className={styles.group}>
              <div className={styles.foodList}>
                {grouped[cat].map((food, i) => (
                  <button
                    key={food.id ?? i}
                    className={styles.foodRow}
                    onClick={() => handleAdd(food)}
                    type="button"
                  >
                    <div className={styles.foodInfo}>
                      <span className={styles.foodName}>{food.name}</span>
                      <span className={styles.foodMeta}>
                        {food.calories_per_100g} kcal · P: {food.protein_per_100g}g · C: {food.carbs_per_100g}g · G: {food.fat_per_100g}g
                        <span className={styles.perHundred}>&nbsp;/ 100g</span>
                      </span>
                    </div>
                    <svg className={styles.addIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
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
