'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './dashboard.module.css';
import clientStyles from '@/app/clients/clients.module.css';

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

const WorkoutPlan = dynamic(() => import('@/app/components/WorkoutPlanGenerator/WorkoutPlan'), {
  ssr: false,
  loading: () => (
    <div className={styles.loadingContainer}>
      <div className={styles.loadingSpinner} />
      <p>Se încarcă planul de antrenament...</p>
    </div>
  )
});

const COOLDOWN_MS = 1 * 60 * 1000;

function ClientDashboardContent() {
  const router = useRouter();
  const { logout, user, login } = useAuth();
  const [loading, setLoading] = useState(true);
  const [mealPlan, setMealPlan] = useState(null);
  const [clientData, setClientData] = useState(null);
  const [nutritionalNeeds, setNutritionalNeeds] = useState(null);
  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [workoutClientData, setWorkoutClientData] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('plan');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(null);
  const [progressFormOpen, setProgressFormOpen] = useState(false);
  const [allNotifications, setAllNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [visibleNotifications, setVisibleNotifications] = useState(5);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const notificationsPanelRef = useRef(null);
  const fetchedRef = useRef(false);

  // Fetch notificări pentru client
  const fetchNotifications = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const response = await fetch('/api/notifications', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        const notifs = (data.notifications || []).map(n => ({
          id: n.id,
          type: n.type,
          title: n.title || '',
          message: n.message || '',
          client_name: n.client_name || '',
          unread: !n.is_read,
          created_at: n.created_at,
          related_plan_id: n.related_plan_id,
          related_client_id: n.related_client_id
        }));
        setAllNotifications(notifs);
      }
    } catch (err) {
      console.error('Eroare la fetch notificări:', err);
    }
  };

  // Formatare timp relativ pentru notificări
  const formatNotificationTime = (created_at) => {
    const now = new Date();
    const then = new Date(created_at);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'acum';
    if (diffMins < 60) return `acum ${diffMins} ${diffMins === 1 ? 'minut' : 'minute'}`;
    if (diffHours < 24) return `acum ${diffHours} ${diffHours === 1 ? 'oră' : 'ore'}`;
    if (diffDays === 1) return 'ieri';
    if (diffDays < 7) return `acum ${diffDays} zile`;
    return then.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
  };

  // Handler click notificare
  const handleNotificationClick = async (notif) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    // Marchează ca citită
    if (notif.unread) {
      try {
        await fetch('/api/notifications', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ notification_ids: [notif.id] })
        });
        
        setAllNotifications(prev =>
          prev.map(n => n.id === notif.id ? { ...n, unread: false } : n)
        );
      } catch (err) {
        console.error('Eroare la marcarea notificării:', err);
      }
    }

    setNotificationsOpen(false);

    // Navigare în funcție de tip
    if (notif.type === 'new_meal_plan') {
      // Forțează reîncărcare completă pentru planul nou
      setMealPlan(null);
      setLoading(true);
      await refreshClientData();
      setActiveTab('plan');
    } else if (notif.type === 'new_workout_plan') {
      await refreshWorkoutPlan(localStorage.getItem('token'), notif.related_plan_id);
      setActiveTab('workout');
    } else if (notif.type === 'progress_update') {
      // Reîncarcă datele pentru a reflecta progresul
      await refreshClientData();
      setActiveTab('plan');
    }
  };

  // Marchează toate ca citite
  const markAllAsRead = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ mark_all: true })
      });

      setAllNotifications(prev => prev.map(n => ({ ...n, unread: false })));
    } catch (err) {
      console.error('Eroare la marcarea tuturor ca citite:', err);
    }
  };

  // Funcție pentru a reîncărca datele clientului
  const refreshClientData = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      // Fetch lista planuri pentru client
      const plansRes = await fetch('/api/meal-plans', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const plansData = await plansRes.json();
      
      if (!plansData.plans || plansData.plans.length === 0) {
        setMealPlan(null);
        setLoading(false);
        return;
      }

      const latestPlan = plansData.plans[0];
      
      // Fetch detalii plan
      const planRes = await fetch(`/api/meal-plans/${latestPlan.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const planData = await planRes.json();
      
      if (planData && planData.mealPlan) {
        const { plan_data, daily_targets, client_id } = planData.mealPlan;
        const c = planData.client || {};
        
        // Setează meal plan și nutritional needs
        setMealPlan(plan_data);
        setNutritionalNeeds(daily_targets);
        
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
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Eroare la reîncărcarea datelor clientului:', err);
      setLoading(false);
    }
  };

  const refreshWorkoutPlan = async (token, preferredPlanId = null) => {
    if (!token) return;
    try {
      let latestId = preferredPlanId;
      if (!latestId) {
        const plansRes = await fetch('/api/workout-plans', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!plansRes.ok) return;
        const plansData = await plansRes.json();
        if (!plansData.plans || plansData.plans.length === 0) {
          setWorkoutPlan(null);
          setWorkoutClientData(null);
          return;
        }
        latestId = plansData.plans[0].id;
      }

      const planRes = await fetch(`/api/workout-plans/${latestId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!planRes.ok) return;
      const planData = await planRes.json();
      if (planData.workoutPlan) {
        setWorkoutPlan(planData.workoutPlan.plan_data || planData.workoutPlan);
        setWorkoutClientData(planData.client || null);
      }
    } catch (err) {
      console.error('Eroare la fetch workout plan:', err);
    }
  };

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const token = localStorage.getItem('token');
    if (!token) {
      Promise.resolve().then(() => {
        setError('Token de autentificare lipsă.');
        setLoading(false);
      });
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

    // Also fetch workout plan (non-blocking)
    refreshWorkoutPlan(token);
  }, []);

  // Auto-refresh notificări
  useEffect(() => {
    Promise.resolve().then(fetchNotifications);
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  // Infinite scroll pentru notificări pe mobil
  useEffect(() => {
    const panel = notificationsPanelRef.current;
    if (!panel) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = panel;
      if (scrollHeight - scrollTop <= clientHeight + 50 && !loadingNotifications) {
        setLoadingNotifications(true);
        setTimeout(() => {
          setVisibleNotifications(prev => prev + 5);
          setLoadingNotifications(false);
        }, 300);
      }
    };

    panel.addEventListener('scroll', handleScroll);
    return () => panel.removeEventListener('scroll', handleScroll);
  }, [loadingNotifications]);

  // Click outside to close notifications
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notificationsPanelRef.current && 
          !notificationsPanelRef.current.contains(event.target) &&
          !event.target.closest('[data-notification-trigger]')) {
        setNotificationsOpen(false);
      }
    };

    if (notificationsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [notificationsOpen]);

  const handleProgressSubmit = async (progressData) => {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Token de autentificare lipsă.');

    const notesFormatted = `[CLIENT] Nutriție - Respectare: ${progressData.adherence} | Energie: ${progressData.energyLevel} | Foame: ${progressData.hungerLevel}${progressData.notes ? ' | Mesaj: ' + progressData.notes : ''} || Antrenament - Respectare: ${progressData.workoutAdherence} | Dificultate: ${progressData.workoutDifficulty}${progressData.muscleSoreness ? ' | DOMS: ' + progressData.muscleSoreness : ''}${progressData.pump ? ' | Pump: ' + progressData.pump : ''}${progressData.generalFatigue ? ' | Oboseala: ' + progressData.generalFatigue : ''}${progressData.workoutNotes ? ' | Note: ' + progressData.workoutNotes : ''}`;

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

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', email: '', currentPassword: '', newPassword: '' });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);
  const [passwordResetMessage, setPasswordResetMessage] = useState('');
  const [passwordResetError, setPasswordResetError] = useState('');

  const openProfile = () => {
    setProfileForm({ name: user?.name || '', email: user?.email || '', currentPassword: '', newPassword: '' });
    setProfileError('');
    setProfileSuccess('');
    setPasswordResetMessage('');
    setPasswordResetError('');
    setProfileOpen(true);
    setSidebarOpen(false);
  };

  const closeProfile = () => {
    setProfileOpen(false);
    setProfileError('');
    setProfileSuccess('');
    setPasswordResetMessage('');
    setPasswordResetError('');
  };

  const handleSendPasswordReset = async () => {
    setPasswordResetLoading(true);
    setPasswordResetMessage('');
    setPasswordResetError('');

    try {
      const resetEmail = user?.email || profileForm.email;
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      });
      const data = await res.json();

      if (!res.ok) {
        setPasswordResetError(data.error || 'Nu am putut trimite linkul de resetare.');
        return;
      }

      setPasswordResetMessage(`Am trimis un link de resetare la ${resetEmail}.`);
    } catch {
      setPasswordResetError('Eroare de rețea. Încearcă din nou.');
    } finally {
      setPasswordResetLoading(false);
    }
  };

  const handleProfileSave = async () => {
    setProfileLoading(true);
    setProfileError('');
    setProfileSuccess('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: profileForm.name !== user?.name ? profileForm.name : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setProfileError(data.error || 'Eroare la salvare.'); return; }
      const updated = { ...user, ...data.user };
      localStorage.setItem('user', JSON.stringify(updated));
      login(updated, token);
      setProfileSuccess('Datele au fost salvate cu succes!');
    } catch {
      setProfileError('Eroare de rețea. Încearcă din nou.');
    } finally {
      setProfileLoading(false);
    }
  };

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
            <span style={{fontFamily:'var(--font-space-grotesk), var(--font-inter), sans-serif',fontWeight:700,fontSize:'20px',color:'#B7FF00',letterSpacing:'-0.5px'}}>trevano</span>
          </div>
        </div>
        {sidebarOpen && <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />}
        <div className={styles.pageLayout}>
          <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
            <div className={styles.sidebarLogo}>
              <span style={{fontFamily:'var(--font-space-grotesk), var(--font-inter), sans-serif',fontWeight:700,fontSize:'20px',color:'#B7FF00',letterSpacing:'-0.5px'}}>trevano</span>
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
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </div>
              <span className={styles.sidebarLabel}>Notificări</span>
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
            <div className={styles.skeletonWrap}>
              <div className={styles.skeletonClientHeader}>
                <div className={styles.skeletonNameBlock}>
                  <div className={`${styles.shimmer} ${styles.skeletonName}`} />
                  <div className={`${styles.shimmer} ${styles.skeletonSub}`} />
                </div>
                <div className={styles.skeletonStats}>
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className={`${styles.shimmer} ${styles.skeletonStat}`} />
                  ))}
                </div>
              </div>
              <div className={styles.skeletonRightColumn}>
                <div className={styles.skeletonTabsRow}>
                  <div className={styles.skeletonTabGroup}>
                    {[1, 2, 3, 4, 5, 6, 7].map(i => (
                      <div key={i} className={`${styles.shimmer} ${styles.skeletonTab}`} />
                    ))}
                  </div>
                  <div className={`${styles.shimmer} ${styles.skeletonDownload}`} />
                </div>
                <div className={styles.skeletonBar} />
                <div className={styles.skeletonMealsGrid}>
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className={`${styles.shimmer} ${styles.skeletonMealCard}`} />
                  ))}
                </div>
              </div>
            </div>
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
          <span style={{fontFamily:'var(--font-space-grotesk), var(--font-inter), sans-serif',fontWeight:700,fontSize:'20px',color:'#B7FF00',letterSpacing:'-0.5px'}}>trevano</span>
        </div>
        <button 
          className={styles.mobileNotificationBtn}
          onClick={() => setNotificationsOpen(v => !v)}
          aria-label="Notificări"
          data-notification-trigger
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {allNotifications.filter(n => n.unread).length > 0 && (
            <span className={styles.mobileDot} />
          )}
        </button>
      </div>

      {sidebarOpen && <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />}

      <div className={styles.pageLayout}>
        {/* Sidebar */}
        <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
          <div className={styles.sidebarLogo}>
            <span style={{fontFamily:'var(--font-space-grotesk), var(--font-inter), sans-serif',fontWeight:700,fontSize:'20px',color:'#B7FF00',letterSpacing:'-0.5px'}}>trevano</span>
            <button className={styles.sidebarCloseBtn} onClick={() => setSidebarOpen(false)} aria-label="Închide meniu">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className={styles.sidebarSection}>Meniu</div>

          <div
            className={`${styles.sidebarItem} ${notificationsOpen ? styles.sidebarItemActive : ''}`}
            onClick={() => setNotificationsOpen(v => !v)}
            data-notification-trigger
          >
            <div className={styles.sidebarIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <span className={styles.sidebarLabel}>Notificări</span>
            {allNotifications.filter(n => n.unread).length > 0 && (
              <span className={styles.sidebarDot} />
            )}
          </div>

          {notificationsOpen && (
            <div className={styles.notificationsPanel} ref={notificationsPanelRef}>
              <div className={styles.notificationsPanelHeader}>
                <h3 className={styles.notificationsPanelTitle}>Notificări</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {allNotifications.some(n => n.unread) && (
                    <button className={styles.markAllReadBtn} onClick={markAllAsRead}>
                      Marchează toate ca citite
                    </button>
                  )}
                  <button 
                    className={styles.notificationCloseBtn}
                    onClick={() => setNotificationsOpen(false)}
                    aria-label="Închide notificări"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div className={styles.notificationsList}>
                {allNotifications.length === 0 ? (
                  <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                    Nu ai notificări
                  </div>
                ) : (
                  allNotifications.slice(0, visibleNotifications).map(notif => {
                    let type = 'system';
                    if (notif.type === 'progress_update') type = 'progress';
                    if (notif.type === 'new_meal_plan') type = 'plan';
                    if (notif.type === 'new_workout_plan') type = 'workout';
                    if (notif.type === 'plan_continued') type = 'continued';

                    return (
                      <div
                        key={notif.id}
                        className={`${styles.notificationItem} ${notif.unread ? styles.notificationUnread : ''}`}
                        onClick={() => handleNotificationClick(notif)}
                      >
                        <div className={styles.notificationIcon}>
                          {type === 'progress' ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                            </svg>
                          ) : type === 'continued' ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          ) : type === 'plan' ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                              <line x1="12" y1="18" x2="12" y2="12"/>
                              <line x1="9" y1="15" x2="15" y2="15"/>
                            </svg>
                          ) : type === 'workout' ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M6.5 6.5v11"/>
                              <path d="M17.5 6.5v11"/>
                              <path d="M3.5 9v6"/>
                              <path d="M20.5 9v6"/>
                              <path d="M6.5 12h11"/>
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"/>
                              <line x1="12" y1="16" x2="12" y2="12"/>
                              <line x1="12" y1="8" x2="12.01" y2="8"/>
                            </svg>
                          )}
                        </div>
                        <div className={styles.notificationContent}>
                          {notif.title && <div className={styles.notificationTitle}>{notif.title}</div>}
                          <div className={styles.notificationMessage}>{notif.message}</div>
                          <div className={styles.notificationTime}>{formatNotificationTime(notif.created_at)}</div>
                        </div>
                        {notif.unread && <div className={styles.notificationDot} />}
                      </div>
                    );
                  })
                )}
                {loadingNotifications && (
                  <div className={styles.loadingMore}>Se încarcă...</div>
                )}
              </div>
            </div>
          )}

          <div className={styles.sidebarFooter}>
            <button className={styles.sidebarProfileBtn} onClick={openProfile}>
              <div className={styles.sidebarProfileAvatar}>
                {(user?.name || 'U').charAt(0).toUpperCase()}
              </div>
              <div className={styles.sidebarProfileInfo}>
                <span className={styles.sidebarProfileName}>{user?.name || 'Profil'}</span>
                <span className={styles.sidebarProfileSub}>Editează contul</span>
              </div>
            </button>
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
          {profileOpen ? (
            <div className={clientStyles.addPage}>
              <div className={clientStyles.addPageShell}>
                <div className={clientStyles.addPageNav}>
                  <button className={clientStyles.addFormBackBtn} onClick={closeProfile} aria-label="Înapoi">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                  </button>
                  <span className={clientStyles.addPageTitle}>Editează profilul</span>
                </div>

                <div className={clientStyles.addWizardHeader}>
                  <div className={clientStyles.addWizardMeta}>
                    <span className={clientStyles.addWizardStep}>Profilul meu</span>
                    <span className={clientStyles.addWizardHint}>Date de cont, parolă și tip cont</span>
                  </div>
                  <div className={clientStyles.addWizardProgress}>
                    <span style={{ width: '100%' }} />
                  </div>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleProfileSave(); }} className={clientStyles.addPageForm} noValidate>
                  <div className={clientStyles.addStepTriple}>
                    <div className={clientStyles.addSection}>
                      <div className={clientStyles.addSectionHeader}>
                        <span className={clientStyles.addSectionNum}>1</span>
                        <span className={clientStyles.addSectionTitle}>Date cont</span>
                      </div>

                      <div className={clientStyles.addField}>
                        <label>Nume</label>
                        <input
                          type="text"
                          value={profileForm.name}
                          onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="Numele tău"
                        />
                      </div>

                      <div className={clientStyles.addField}>
                        <label>Email</label>
                        <input
                          type="email"
                          value={profileForm.email}
                          placeholder="email@exemplu.com"
                          readOnly
                          className={styles.accountReadonlyInput}
                        />
                      </div>
                    </div>

                    <div className={clientStyles.addSection}>
                      <div className={clientStyles.addSectionHeader}>
                        <span className={clientStyles.addSectionNum}>2</span>
                        <span className={clientStyles.addSectionTitle}>Modificare parolă</span>
                      </div>

                      <p className={styles.profileHelpText}>
                        Pentru schimbarea parolei îți trimitem un link securizat pe adresa de email a contului.
                        Linkul expiră în 1 oră.
                      </p>

                      <button
                        type="button"
                        className={styles.accountFormBtn}
                        onClick={handleSendPasswordReset}
                        disabled={passwordResetLoading}
                      >
                        {passwordResetLoading ? 'Se trimite...' : 'Trimite link de resetare'}
                      </button>

                      {passwordResetMessage && <p className={styles.profileModalSuccess}>{passwordResetMessage}</p>}
                      {passwordResetError && <p className={styles.profileModalError}>{passwordResetError}</p>}
                    </div>

                    <div className={clientStyles.addSection}>
                      <div className={clientStyles.addSectionHeader}>
                        <span className={clientStyles.addSectionNum}>3</span>
                        <span className={clientStyles.addSectionTitle}>Tipul contului</span>
                      </div>

                      <div className={clientStyles.addField}>
                        <label>Tip cont</label>
                        <input
                          type="text"
                          value="Client"
                          readOnly
                          className={styles.accountReadonlyInput}
                        />
                      </div>
                    </div>
                  </div>

                  {profileError && <p className={styles.profileModalError}>{profileError}</p>}
                  {profileSuccess && <p className={styles.profileModalSuccess}>{profileSuccess}</p>}

                  <div className={clientStyles.addFooter}>
                    <button type="button" className={clientStyles.cancelBtn} onClick={closeProfile}>
                      Anulează
                    </button>
                    <button type="submit" className={clientStyles.saveBtn} disabled={profileLoading}>
                      {profileLoading ? 'Se salvează...' : 'Salvează modificările'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
          <>
          {/* Tab navigation */}
          {!progressFormOpen && (
          <div className={styles.planTabs}>
            <button
              className={`${styles.planTab} ${activeTab === 'plan' ? styles.planTabActive : ''}`}
              onClick={() => handleTabChange('plan')}
            >
              Plan alimentar
            </button>
            <button
              className={`${styles.planTab} ${activeTab === 'workout' ? styles.planTabActive : ''}`}
              onClick={() => handleTabChange('workout')}
            >
              Plan de antrenament
            </button>
          </div>
          )}

          {!loading && !mealPlan && !error && activeTab === 'plan' && (
            <div className={styles.noPlanEmpty}>
              <p>Antrenorul tău nu a făcut un plan alimentar pentru tine.</p>
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
                  onProgressToggle={(open) => setProgressFormOpen(open)}
                />
              )}
            </>
          )}

          {activeTab === 'workout' && progressFormOpen && workoutPlan && (
            <MealPlan
              key="workout-progress-form"
              plan={null}
              clientData={clientData}
              nutritionalNeeds={null}
              onSubmitProgress={handleProgressSubmit}
              progressCooldownUntil={cooldownUntil}
              onProgressToggle={(open) => setProgressFormOpen(open)}
              workoutOnlyMode
              initialShowProgress
            />
          )}

          {activeTab === 'workout' && !progressFormOpen && (
            workoutPlan ? (
              <WorkoutPlan
                plan={workoutPlan}
                clientData={workoutClientData}
                onSubmitProgress={() => setProgressFormOpen(true)}
                progressCooldownUntil={cooldownUntil}
              />
            ) : (
              <div className={styles.noPlanEmpty}>
                <p>Antrenorul tău nu a făcut un plan de antrenament pentru tine.</p>
              </div>
            )
          )}
          </>
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
