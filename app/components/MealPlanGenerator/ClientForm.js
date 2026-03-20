'use client';

import { useState } from 'react';
import styles from './form.module.css';

export default function ClientForm({ onSubmit, loading }) {
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    gender: 'M',
    weight: '',
    height: '',
    activityLevel: 'moderate',
    goal: 'maintenance',
    dietType: 'omnivore',
    allergies: '',
    mealsPerDay: '3',
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.gridTwoColumns}>
        {/* DESPRE CLIENT */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>DESPRE CLIENT</h3>
          
          <div className={styles.formGroup}>
            <label htmlFor="name">Nume *</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              required
              placeholder="Ex: Ion Popescu"
            />
          </div>

          <div className={styles.formGroupRow}>
            <div className={styles.formGroup}>
              <label htmlFor="age">Vârstă *</label>
              <input
                type="number"
                id="age"
                name="age"
                value={formData.age}
                onChange={handleInputChange}
                required
                min="18"
                max="120"
                placeholder="25"
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="gender">Sex *</label>
              <select
                id="gender"
                name="gender"
                value={formData.gender}
                onChange={handleInputChange}
              >
                <option value="M">Masculin</option>
                <option value="F">Feminin</option>
              </select>
            </div>
          </div>

          <div className={styles.formGroupRow}>
            <div className={styles.formGroup}>
              <label htmlFor="weight">Greutate (kg) *</label>
              <input
                type="number"
                id="weight"
                name="weight"
                value={formData.weight}
                onChange={handleInputChange}
                required
                step="0.1"
                min="30"
                max="300"
                placeholder="75"
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="height">Înălțime (cm) *</label>
              <input
                type="number"
                id="height"
                name="height"
                value={formData.height}
                onChange={handleInputChange}
                required
                min="100"
                max="250"
                placeholder="180"
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="activityLevel">Nivel Activitate *</label>
            <select
              id="activityLevel"
              name="activityLevel"
              value={formData.activityLevel}
              onChange={handleInputChange}
            >
              <option value="sedentary">Sedentar (birou, fără sport)</option>
              <option value="light">Ușor activ (1-3 zile/săptămână)</option>
              <option value="moderate">Moderat activ (3-5 zile/săptămână)</option>
              <option value="very_active">Foarte activ (6-7 zile/săptămână)</option>
            </select>
          </div>
        </div>

        {/* OBIECTIV */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>OBIECTIV</h3>
          
          <div className={styles.formGroup}>
            <label htmlFor="goal">Obiectiv *</label>
            <select
              id="goal"
              name="goal"
              value={formData.goal}
              onChange={handleInputChange}
            >
              <option value="weight_loss">Slăbit</option>
              <option value="muscle_gain">Creștere masă musculară</option>
              <option value="maintenance">Menținere</option>
              <option value="recomposition">Recompoziție corporală</option>
            </select>
          </div>

          {/* PREFERINȚE ALIMENTARE */}
          <h3 className={styles.sectionTitle}>PREFERINȚE ALIMENTARE</h3>

          <div className={styles.formGroup}>
            <label htmlFor="dietType">Tip Dietă *</label>
            <select
              id="dietType"
              name="dietType"
              value={formData.dietType}
              onChange={handleInputChange}
            >
              <option value="omnivore">Omnivor</option>
              <option value="vegetarian">Vegetarian</option>
              <option value="vegan">Vegan</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="allergies">Alergii / Excluderi</label>
            <textarea
              id="allergies"
              name="allergies"
              value={formData.allergies}
              onChange={handleInputChange}
              placeholder="Ex: Arahide, lactate, gluten..."
              rows="3"
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="mealsPerDay">Număr Mese/Zi *</label>
            <select
              id="mealsPerDay"
              name="mealsPerDay"
              value={formData.mealsPerDay}
              onChange={handleInputChange}
            >
              <option value="3">3 mese</option>
              <option value="4">4 mese</option>
              <option value="5">5 mese</option>
            </select>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className={styles.submitBtn}
      >
        {loading ? 'Se generează planul...' : 'Generează Plan Alimentar'}
      </button>
    </form>
  );
}

