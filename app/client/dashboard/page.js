'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './dashboard.module.css';

// Dynamic import cu ssr: false pentru MealPlan (folosește jsPDF)
const MealPlan = dynamic(() => import('@/app/components/MealPlanGenerator/MealPlan'), {
  ssr: false,
  loading: () => (
    <div className={styles.loadingContainer}>
      <div className={styles.loadingSpinner} />
      <p>Se încarcă planul...</p>
    </div>
  )
});

function ClientDashboardContent() {
  const router = useRouter();
  const { logout, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [mealPlan, setMealPlan] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [nutritionalNeeds, setNutritionalNeeds] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('plan');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(null);
  const fetchedRef = useRef(false);
  const COOLDOWN_MS = 1 * 60 * 1000; 

  // Funcție pentru a reîncărca datele clientului
  const refreshClientData = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      // Fetch lista planuri pentru client
      const plansRes = await fetch('/api/meal-plans', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const plansData = await plansRes.json();
      
      if (!plansData.plans || plansData.plans.length === 0) return;

      const latestPlan = plansData.plans[0];
      
      // Fetch detalii plan
      const planRes = await fetch(`/api/meal-plans/${latestPlan.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const planData = await planRes.json();
      
      if (planData && planData.mealPlan) {
        const { client_id } = planData.mealPlan;
        const c = planData.client || {};
        
        setClientData(prev => ({
          ...prev,
          weight: c.weight ? String(c.weight) : prev?.weight,
          age: c.age ? String(c.age) : prev?.age,
          height: c.height ? String(c.height) : prev?.height,
        }));
      }
    } catch (err) {
      console.error('Eroare la reîncărcarea datelor clientului:', err);
    }
  };

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const token = localStorage.getItem('token');
    if (!token) {
      setError('Token de autentificare lipsă.');
      setLoading(false);
      return;
    }

    // Fetch lista planuri pentru client
    fetch('/api/meal-plans', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (!data.plans || data.plans.length === 0) {
          setError(null);
          setMealPlan(null);
          setLoading(false);
          return;
        }

        // Ia cel mai recent plan
        const latestPlan = data.plans[0];
        
        // Fetch detalii plan
        return fetch(`/api/meal-plans/${latestPlan.id}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
      })
      .then(res => res ? res.json() : null)
      .then(data => {
        if (!data || !data.mealPlan) {
          setLoading(false);
          return;
        }

        const { plan_data, daily_targets, client_id } = data.mealPlan;
        setMealPlan(plan_data);
        setNutritionalNeeds(daily_targets);
        
        const c = data.client || {};
        setClientData({
          clientId: client_id,
          name: c.name || plan_data.clientName,
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

        // Fetch cooldown în același lanț — loading rămâne true până știm răspunsul
        return fetch(`/api/clients/${client_id}/weight-history`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
      })
      .then(res => res ? res.json() : null)
      .then(data => {
        if (data?.weightHistory) {
          const lastClientEntry = data.weightHistory.find(h => h.notes?.startsWith('[CLIENT]'));
          if (lastClientEntry) {
            const nextDate = new Date(new Date(lastClientEntry.recorded_at).getTime() + COOLDOWN_MS);
            if (nextDate > new Date()) {
              setCooldownUntil(nextDate.toISOString());
            }
          }
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Eroare la încărcarea planului:', err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const handleProgressSubmit = async (progressData) => {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Token de autentificare lipsă.');

    const notesFormatted = `[CLIENT] Respectare: ${progressData.adherence} | Energie: ${progressData.energyLevel} | Foame: ${progressData.hungerLevel}${progressData.notes ? ' | Mesaj: ' + progressData.notes : ''}`;

    const response = await fetch(`/api/clients/${clientData.clientId}/weight-history`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        weight: progressData.currentWeight,
        notes: notesFormatted,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Eroare la trimiterea progresului.');
    }

    const nextDate = new Date(Date.now() + COOLDOWN_MS);
    setCooldownUntil(nextDate.toISOString());
    
    // Actualizează greutatea local imediat cu valoarea trimisă
    setClientData(prev => ({
      ...prev,
      weight: String(progressData.currentWeight)
    }));
    
    return { success: true };
  };

  const firstName = user?.name?.split(' ')[0] || user?.name || '';

  const handleLogout = () => { logout(); router.push('/'); };
  const handleTabChange = (tab) => { setActiveTab(tab); setSidebarOpen(false); };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.mobileTopbar}>
          <button className={styles.hamburger} onClick={() => setSidebarOpen(v => !v)} aria-label="Meniu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <div className={styles.mobileLogo}>
            <div className={styles.sidebarLogoMark}>N</div>
            <span className={styles.sidebarLogoText}>NutriApp</span>
          </div>
        </div>
        {sidebarOpen && <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />}
        <div className={styles.pageLayout}>
          <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
            <div className={styles.sidebarLogo}>
              <div className={styles.sidebarLogoMark}>N</div>
              <span className={styles.sidebarLogoText}>NutriApp</span>
              <button className={styles.sidebarCloseBtn} onClick={() => setSidebarOpen(false)} aria-label="Închide meniu">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div className={styles.sidebarSection}>Meniu</div>
            <div className={`${styles.sidebarItem} ${styles.sidebarItemActive}`}>
              <div className={styles.sidebarIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
              </div>
              <span className={styles.sidebarLabel}>Plan Alimentar</span>
            </div>
            <div className={styles.sidebarFooter}>
              <button className={styles.sidebarLogoutBtn} onClick={handleLogout}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Ieșire
              </button>
            </div>
          </aside>
          <main className={styles.main}>
            <div className={styles.loadingSpinner}></div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.mobileTopbar}>
        <button className={styles.hamburger} onClick={() => setSidebarOpen(v => !v)} aria-label="Meniu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <div className={styles.mobileLogo}>
          <div className={styles.sidebarLogoMark}>N</div>
          <span className={styles.sidebarLogoText}>NutriApp</span>
        </div>
      </div>

      {sidebarOpen && <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />}

      <div className={styles.pageLayout}>
        {/* Sidebar */}
        <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
          <div className={styles.sidebarLogo}>
            <div className={styles.sidebarLogoMark}>N</div>
            <span className={styles.sidebarLogoText}>NutriApp</span>
            <button className={styles.sidebarCloseBtn} onClick={() => setSidebarOpen(false)} aria-label="Închide meniu">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className={styles.sidebarSection}>Meniu</div>

          <div
            className={`${styles.sidebarItem} ${activeTab === 'plan' ? styles.sidebarItemActive : ''}`}
            onClick={() => handleTabChange('plan')}
          >
            <div className={styles.sidebarIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </div>
            <span className={styles.sidebarLabel}>Plan Alimentar</span>
          </div>

          <div
            className={`${styles.sidebarItem} ${activeTab === 'workout' ? styles.sidebarItemActive : ''}`}
            onClick={() => handleTabChange('workout')}
          >
            <div className={styles.sidebarIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.5 6.5l11 11"/>
                <path d="M17.5 6.5l-11 11"/>
                <circle cx="12" cy="12" r="2"/>
                <path d="M6.5 17.5L5 19M17.5 6.5L19 5M6.5 6.5L5 5M17.5 17.5L19 19"/>
              </svg>
            </div>
            <span className={styles.sidebarLabel}>Plan Antrenament</span>
          </div>

          <div className={styles.sidebarFooter}>
            <button className={styles.sidebarLogoutBtn} onClick={handleLogout}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Ieșire
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className={styles.main}>
          <div className={styles.hero}>
            <h2 className={styles.heroHeading}>
              Bună ziua, <span className={styles.accent}>{firstName}</span>.
            </h2>
            <p className={styles.heroSub}>
              Vizualizează planul tău alimentar și programul de antrenament.
            </p>
          </div>

          {!loading && !mealPlan && !error && activeTab === 'plan' && (
            <div className={styles.noPlanEmpty}>
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="12" x2="12" y2="16"/>
                <line x1="10" y1="14" x2="14" y2="14"/>
              </svg>
              <p>Antrenorul tău nu ți-a creat încă un plan alimentar.</p>
            </div>
          )}

          {activeTab === 'plan' && (
            <>
              {error && (
                <div className={styles.error}>
                  <span className={styles.errorIcon}>⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              {mealPlan && (
                <MealPlan
                  key={`mealplan-${clientData?.weight || 'initial'}`}
                  plan={mealPlan}
                  clientData={clientData}
                  nutritionalNeeds={nutritionalNeeds}
                  onSubmitProgress={handleProgressSubmit}
                  progressCooldownUntil={cooldownUntil}
                />
              )}
            </>
          )}

          {activeTab === 'workout' && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🏋️</div>
              <h2 className={styles.emptyTitle}>Plan de antrenament</h2>
              <p className={styles.emptyDesc}>
                Antrenorul tău pregătește un program de antrenament personalizat.<br />
                Revino curând!
              </p>
              <div className={styles.emptyTips}>
                <h3 className={styles.emptyTipsTitle}>💡 Între timp, poți:</h3>
                <ul className={styles.emptyTipsList}>
                  <li>Urmărești progresul greutății tale</li>
                  <li>Respecți planul alimentar</li>
                  <li>Consulți obiectivul tău de fitness</li>
                </ul>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function ClientDashboard() {
  return (
    <ProtectedRoute requiredRole="client">
      <ClientDashboardContent />
    </ProtectedRoute>
  );
}
