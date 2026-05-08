'use client';

import { useState } from 'react';
import styles from './form.module.css';

const SPLIT_OPTIONS = [
  'Full Body',
  'Push/Pull/Legs',
  'Upper/Lower',
  'Bro Split',
];

const SPLIT_LABELS = {
  'Full Body': 'Full Body',
  'Push/Pull/Legs': 'PPL',
  'Upper/Lower': 'Upper/Lower',
  'Bro Split': 'Bro Split',
};

const WORKOUTS_OPTIONS = ['2', '3', '4', '5'];

const LEVEL_OPTIONS = [
  { value: 'beginner',     label: 'Începător' },
  { value: 'intermediate', label: 'Intermediar' },
  { value: 'advanced',     label: 'Avansat' },
];

const EQUIPMENT_OPTIONS = [
  { value: 'no equipment',   label: 'Fără echipament' },
  { value: 'dumbbells only', label: 'Doar gantere' },
  { value: 'full gym',       label: 'Sală completă' },
];

const GOAL_OPTIONS = [
  { value: 'muscle gain', label: 'Masă musculară' },
  { value: 'weight loss', label: 'Slăbit' },
  { value: 'strength',    label: 'Forță' },
  { value: 'endurance',   label: 'Rezistență' },
];

export default function WorkoutPlanForm({ onSubmit, loading }) {
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    gender: 'M',
    weight: '',
    height: '',
    trainingSplit: 'Full Body',
    workoutsPerWeek: '3',
    fitnessLevel: 'beginner',
    availableEquipment: 'full gym',
    fitnessGoal: 'muscle gain',
    injuriesLimitations: '',
    workoutPreferences: '',
  });

  const set = (field, value) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const handleInput = (e) => {
    const { name, value } = e.target;
    set(name, value);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.gridTwoColumns}>
        {/* ── DESPRE CLIENT ── */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>DESPRE CLIENT</h3>

          <div className={styles.formGroup}>
            <label htmlFor="name">Nume *</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInput}
              required
              placeholder="Ex: Ion Popescu"
            />
          </div>

          <div className={styles.formGroupRow}>
            <div className={styles.formGroup}>
              <label htmlFor="age">Vârstă</label>
              <input
                type="number"
                id="age"
                name="age"
                value={formData.age}
                onChange={handleInput}
                min="14"
                max="100"
                placeholder="25"
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="gender">Sex</label>
              <select id="gender" name="gender" value={formData.gender} onChange={handleInput}>
                <option value="M">Masculin</option>
                <option value="F">Feminin</option>
              </select>
            </div>
          </div>

          <div className={styles.formGroupRow}>
            <div className={styles.formGroup}>
              <label htmlFor="weight">Greutate (kg)</label>
              <input
                type="number"
                id="weight"
                name="weight"
                value={formData.weight}
                onChange={handleInput}
                step="0.1"
                min="30"
                max="300"
                placeholder="75"
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="height">Înălțime (cm)</label>
              <input
                type="number"
                id="height"
                name="height"
                value={formData.height}
                onChange={handleInput}
                min="100"
                max="250"
                placeholder="180"
              />
            </div>
          </div>

          {/* ── LIMITĂRI ── */}
          <div className={styles.formGroup} style={{ marginTop: '1rem' }}>
            <label htmlFor="injuriesLimitations">Accidentări / Limitări</label>
            <textarea
              id="injuriesLimitations"
              name="injuriesLimitations"
              value={formData.injuriesLimitations}
              onChange={handleInput}
              placeholder="Ex: Genunchi drept operat, dureri lombare..."
              rows="3"
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="workoutPreferences">Preferințe antrenament</label>
            <textarea
              id="workoutPreferences"
              name="workoutPreferences"
              value={formData.workoutPreferences}
              onChange={handleInput}
              placeholder="Ex: Prefer exerciții compound, nu îmi plac flotările..."
              rows="3"
            />
          </div>
        </div>

        {/* ── PROGRAM ── */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>PROGRAM ANTRENAMENT</h3>

          {/* Split */}
          <div className={styles.formGroup}>
            <label htmlFor="trainingSplit">Split *</label>
            <select
              id="trainingSplit"
              name="trainingSplit"
              value={formData.trainingSplit}
              onChange={handleInput}
            >
              {SPLIT_OPTIONS.map(s => (
                <option key={s} value={s}>{SPLIT_LABELS[s] || s}</option>
              ))}
            </select>
          </div>

          {/* Workouts / week */}
          <div className={styles.formGroup}>
            <label>Antrenamente / săptămână *</label>
            <div className={styles.segmentedGroup}>
              {WORKOUTS_OPTIONS.map(v => (
                <button
                  key={v}
                  type="button"
                  className={`${styles.segmentBtn} ${formData.workoutsPerWeek === v ? styles.segmentBtnActive : ''}`}
                  onClick={() => set('workoutsPerWeek', v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Fitness level */}
          <div className={styles.formGroup}>
            <label>Nivel fitness *</label>
            <div className={styles.segmentedGroup}>
              {LEVEL_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  className={`${styles.segmentBtn} ${formData.fitnessLevel === o.value ? styles.segmentBtnActive : ''}`}
                  onClick={() => set('fitnessLevel', o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Equipment */}
          <div className={styles.formGroup}>
            <label>Echipament disponibil *</label>
            <div className={styles.segmentedGroup}>
              {EQUIPMENT_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  className={`${styles.segmentBtn} ${formData.availableEquipment === o.value ? styles.segmentBtnActive : ''}`}
                  onClick={() => set('availableEquipment', o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Goal */}
          <div className={styles.formGroup}>
            <label>Obiectiv *</label>
            <div className={styles.segmentedGroup}>
              {GOAL_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  className={`${styles.segmentBtn} ${formData.fitnessGoal === o.value ? styles.segmentBtnActive : ''}`}
                  onClick={() => set('fitnessGoal', o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className={styles.submitBtn}
      >
        {loading ? 'Se generează planul...' : 'Generează Plan Antrenament'}
      </button>
    </form>
  );
}
