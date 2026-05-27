'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/app/contexts/AuthContext';
import Link from 'next/link';
import styles from '@/app/client/dashboard/dashboard.module.css';

const MealPlan = dynamic(() => import('@/app/components/MealPlanGenerator/MealPlan'), {
  ssr: false,
  loading: () => (
    <div className={styles.loadingContainer}>
      <div className={styles.loadingSpinner} />
      <p>Se încarcă planul alimentar...</p>
    </div>
  ),
});

const WorkoutPlan = dynamic(() => import('@/app/components/WorkoutPlanGenerator/WorkoutPlan'), {
  ssr: false,
  loading: () => (
    <div className={styles.loadingContainer}>
      <div className={styles.loadingSpinner} />
      <p>Se încarcă planul de antrenament...</p>
    </div>
  ),
});

function MyPlansContent() {
  const router = useRouter();
  const { user, token, loading: authLoading, logout } = useAuth();
  const fetchedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mealPlan, setMealPlan] = useState(null);
  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [nutritionalNeeds, setNutritionalNeeds] = useState(null);
  const [activeTab, setActiveTab] = useState('alimentar');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.replace('/auth');
      return;
    }

    if (user.role !== 'user') {
      router.replace('/dashboard');
      return;
    }

    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const tok = token || localStorage.getItem('token');

    // Verifică mai întâi dacă onboarding-ul e completat (din BD)
    fetch('/api/user/onboarding', {
      headers: { 'Authorization': `Bearer ${tok}` },
    })
      .then(res => res.json())
      .then(data => {
        if (!data.onboarding_completed) {
          router.replace('/onboarding');
          return;
        }
        // Onboarding completat → încarcă planurile
        return fetch('/api/user/plans', {
          headers: { 'Authorization': `Bearer ${tok}` },
        });
      })
      .then(res => res ? res.json() : null)
      .then(data => {
        if (!data) return;
        if (data.error) throw new Error(data.error);

        const c = data.client || {};
        setClientData({
          clientId: c.id,
          name: c.name || user?.name || 'Tu',
          age: c.age ? String(c.age) : undefined,
          weight: c.weight ? String(c.weight) : undefined,
          height: c.height ? String(c.height) : undefined,
          gender: c.gender,
          goal: c.goal,
          activityLevel: c.activity_level,
          dietType: c.diet_type,
          allergies: c.allergies,
          mealsPerDay: c.meals_per_day ? String(c.meals_per_day) : undefined,
          foodPreferences: c.food_preferences || '',
        });

        if (data.mealPlan) {
          setMealPlan(data.mealPlan.plan_data || data.mealPlan);
          setNutritionalNeeds(data.mealPlan.daily_targets || null);
        }

        if (data.workoutPlan) {
          setWorkoutPlan(data.workoutPlan.plan_data || data.workoutPlan);
        }
      })
      .catch(err => setError(err.message || 'Eroare la încărcarea planurilor.'))
      .finally(() => setLoading(false));
  }, [authLoading, user, token, router]);

  const handleLogout = () => {
    logout();
    router.push('/auth');
  };

  if (authLoading || loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingContainer} style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
          <div className={styles.loadingSpinner} />
          <p style={{ color: 'rgba(255,255,255,0.5)' }}>Se încarcă planurile tale...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div
          className={styles.sidebarOverlay}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarLogo}>trevano</span>
          <button className={styles.sidebarClose} onClick={() => setSidebarOpen(false)} aria-label="Închide meniul">✕</button>
        </div>
        <nav className={styles.sidebarNav}>
          <div className={styles.sidebarSection}>
            <span className={styles.sidebarSectionLabel}>Planuri</span>
            <button
              className={`${styles.sidebarItem} ${activeTab === 'alimentar' ? styles.sidebarItemActive : ''}`}
              onClick={() => { setActiveTab('alimentar'); setSidebarOpen(false); }}
            >
              🥗 Plan alimentar
            </button>
            <button
              className={`${styles.sidebarItem} ${activeTab === 'antrenament' ? styles.sidebarItemActive : ''}`}
              onClick={() => { setActiveTab('antrenament'); setSidebarOpen(false); }}
            >
              💪 Plan antrenament
            </button>
          </div>
          <div className={styles.sidebarSection} style={{ marginTop: 'auto' }}>
            <button className={styles.sidebarItem} onClick={handleLogout}>
              🚪 Deconectare
            </button>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <div className={styles.mainWrapper}>
        {/* Header */}
        <header className={styles.topBar}>
          <button className={styles.menuBtn} onClick={() => setSidebarOpen(true)} aria-label="Deschide meniul">
            <span /><span /><span />
          </button>
          <span className={styles.topBarTitle}>Planurile mele</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/onboarding" style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', textDecoration: 'none', padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)' }}>
              Reface onboarding
            </Link>
          </div>
        </header>

        {/* Tab switcher */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'alimentar' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('alimentar')}
          >
            Plan alimentar
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'antrenament' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('antrenament')}
          >
            Plan antrenament
          </button>
        </div>

        <main className={styles.mainContent}>
          {error && (
            <div className={styles.error}>
              <span>⚠️</span> {error}
            </div>
          )}

          {/* Plan alimentar */}
          {activeTab === 'alimentar' && (
            mealPlan ? (
              <MealPlan
                plan={mealPlan}
                clientData={clientData}
                nutritionalNeeds={nutritionalNeeds}
                hideReviewActions
              />
            ) : (
              !error && (
                <div className={styles.noPlanEmpty}>
                  <p>Nu ai încă un plan alimentar.</p>
                  <Link href="/onboarding" style={{ color: '#B7FF00', textDecoration: 'none', fontWeight: 600 }}>
                    Completează profilul pentru a genera un plan →
                  </Link>
                </div>
              )
            )
          )}

          {/* Plan antrenament */}
          {activeTab === 'antrenament' && (
            workoutPlan ? (
              <WorkoutPlan
                plan={workoutPlan}
                clientData={clientData}
                hideReviewActions
              />
            ) : (
              !error && (
                <div className={styles.noPlanEmpty}>
                  <p>Nu ai încă un plan de antrenament.</p>
                </div>
              )
            )
          )}
        </main>
      </div>
    </div>
  );
}

export default function MyPlansPage() {
  return <MyPlansContent />;
}
