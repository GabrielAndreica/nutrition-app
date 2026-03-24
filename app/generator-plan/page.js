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
  const [loadingStep, setLoadingStep] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [nutritionalNeeds, setNutritionalNeeds] = useState(null);

  const handleGeneratePlan = async (formData) => {
    setLoading(true);
    setLoadingStep(0);
    setLoadingProgress(0);
    setError(null);
    setClientData(formData);

    try {
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

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'progress') {
            setLoadingStep(event.day);
            setLoadingProgress(Math.round((event.day / event.total) * 90));
          } else if (event.type === 'complete') {
            setLoadingProgress(100);
            setMealPlan(event.plan);
            setNutritionalNeeds(event.nutritionalNeeds);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          }
        }
      }
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
            <button className={styles.backBtn} onClick={() => router.push('/dashboard')}>
              ← Înapoi
            </button>
            <h1>Generator Plan Alimentar</h1>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {!mealPlan ? (
          <>
            {loading ? (
              <div className={styles.loadingWrapper}>
                <div className={styles.loadingBox}>
                  <p className={styles.loadingTitle}>Se generează planul alimentar</p>
                  <p className={styles.loadingStep}>
                    {loadingStep > 0 ? `Ziua ${loadingStep} din 7...` : 'Se pregăteşte...'}
                  </p>
                  <div className={styles.progressTrack}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${loadingProgress}%` }}
                    />
                  </div>
                  <div className={styles.progressDots}>
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <div
                        key={d}
                        className={`${styles.progressDot} ${
                          d < loadingStep ? styles.progressDotDone :
                          d === loadingStep ? styles.progressDotActive : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <ClientForm onSubmit={handleGeneratePlan} loading={loading} />
            )}
            {error && (
              <div className={styles.error}>
                <span className={styles.errorIcon}>⚠️</span>
                <span>{error}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <MealPlan plan={mealPlan} clientData={clientData} nutritionalNeeds={nutritionalNeeds} onReset={handleReset} />
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
