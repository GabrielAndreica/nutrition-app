'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import ClientForm from '@/app/components/MealPlanGenerator/ClientForm';
import MealPlan from '@/app/components/MealPlanGenerator/MealPlan';
import styles from './generator.module.css';

function GeneratorContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [mealPlan, setMealPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [nutritionalNeeds, setNutritionalNeeds] = useState(null);

  const handleGeneratePlan = async (formData) => {
    setLoading(true);
    setError(null);
    setClientData(formData);

    try {
      // Get JWT token from localStorage
      const token = localStorage.getItem('token');

      if (!token) {
        throw new Error('Token de autentificare lipsă. Vă rog reconectați.');
      }

      const response = await fetch('/api/generate-meal-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Eroare la generarea planului alimentar');
      }

      const data = await response.json();
      setMealPlan(data.plan);
      setNutritionalNeeds(data.nutritionalNeeds);
    } catch (err) {
      setError(err.message);
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setMealPlan(null);
    setClientData(null);
    setNutritionalNeeds(null);
    setError(null);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.headerTitle}>
            <button className={styles.backBtn} onClick={() => router.back()}>
              ← Înapoi
            </button>
            <h1>Generator Plan Alimentar</h1>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {!mealPlan ? (
          <>
            <ClientForm onSubmit={handleGeneratePlan} loading={loading} />
            {error && <div className={styles.error}>{error}</div>}
          </>
        ) : (
          <>
            <MealPlan plan={mealPlan} clientData={clientData} nutritionalNeeds={nutritionalNeeds} />
            <button className={styles.resetBtn} onClick={handleReset}>
              Generează Alt Plan
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function GeneratorPage() {
  return (
    <ProtectedRoute>
      <GeneratorContent />
    </ProtectedRoute>
  );
}
