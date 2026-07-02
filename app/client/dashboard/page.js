'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './dashboard.module.css';
import clientStyles from '@/app/clients/clients.module.css';

const fireConfetti = async () => {
  const confetti = (await import('canvas-confetti')).default;
  const colors = ['#b7ff00', '#0a0a0a', '#ffffff', '#a3e635', '#fbbf24'];
  confetti({
    particleCount: 120,
    spread: 80,
    origin: { y: 0.55 },
    colors,
    zIndex: 9999,
  });
  setTimeout(() => confetti({
    particleCount: 60,
    spread: 60,
    origin: { y: 0.5, x: 0.3 },
    colors,
    zIndex: 9999,
  }), 150);
  setTimeout(() => confetti({
    particleCount: 60,
    spread: 60,
    origin: { y: 0.5, x: 0.7 },
    colors,
    zIndex: 9999,
  }), 300);
};

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

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function getLevelInfoFromXp(xp) {
  const totalXp = Math.max(0, Number(xp) || 0);
  let level = 1;
  while (((level + 1) * level) / 2 * 100 <= totalXp) {
    level++;
  }

  const xpStartOfLevel = (level * (level - 1)) / 2 * 100;
  const xpForNextLevel = level * 100;
  const xpInCurrentLevel = totalXp - xpStartOfLevel;
  const progressPct = Math.min(100, Math.round((xpInCurrentLevel / xpForNextLevel) * 100));

  return {
    level,
    totalXp,
    xpInCurrentLevel,
    xpForNextLevel,
    progressPct,
  };
}

function getLevelUpPayload(previousLevelInfo, nextLevelInfo, xpAdded = 50) {
  if (!nextLevelInfo?.level) return null;
  const previous = previousLevelInfo || getLevelInfoFromXp((Number(nextLevelInfo.totalXp) || 0) - xpAdded);
  if (!previous?.level || nextLevelInfo.level <= previous.level) return null;

  return {
    fromLevel: previous.level,
    toLevel: nextLevelInfo.level,
    levelInfo: nextLevelInfo,
  };
}

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
  const [mealsCooldownUntil, setMealsCooldownUntil] = useState(null);
  const [workoutCooldownUntil, setWorkoutCooldownUntil] = useState(null);
  const [mealsCompletedDays, setMealsCompletedDays] = useState(0);
  const [workoutCompletedDays, setWorkoutCompletedDays] = useState(0);
  const [currentPlanDay, setCurrentPlanDay] = useState(0);
  const [mealDayStatus, setMealDayStatus] = useState({});
  const [workoutDayStatus, setWorkoutDayStatus] = useState({});
  const [streakCount, setStreakCount] = useState(0);
  const [streakState, setStreakState] = useState('normal');
  const [weeklyPlanRegenerating, setWeeklyPlanRegenerating] = useState(false);
  const [weeklyRegenProgress, setWeeklyRegenProgress] = useState(6);
  const [weeklyRegenStep, setWeeklyRegenStep] = useState(0);
  const [weeklyRegenMessage, setWeeklyRegenMessage] = useState('Pregătim planurile noi...');
  const [progressFormOpen, setProgressFormOpen] = useState(false);
  const [allNotifications, setAllNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [visibleNotifications, setVisibleNotifications] = useState(5);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const notificationsPanelRef = useRef(null);
  const fetchedRef = useRef(false);
  const startWeeklyPlanRegenerationRef = useRef(null);

  // Skip skeleton on refresh when we already know user has no plan
  const [knownNoPlan] = useState(() => {
    try { return localStorage.getItem('noPlanUser') === '1'; } catch { return false; }
  });

  // XP / Nivel
  const [userLevel, setUserLevel] = useState(null); // { level, totalXp, xpInCurrentLevel, xpForNextLevel, progressPct }
  // Confirm finish modal: null | { type: 'meals' | 'workout', dayIndex: number, isRecovery?: boolean }
  const [confirmFinish, setConfirmFinish] = useState(null);
  const [finishReward, setFinishReward] = useState(null);
  const [pendingLevelUp, setPendingLevelUp] = useState(null);
  const [levelUpReward, setLevelUpReward] = useState(null);

  useEffect(() => {
    if (!weeklyPlanRegenerating) return;
    const interval = setInterval(() => {
      setWeeklyRegenProgress(prev => Math.min(96, prev + (prev < 35 ? 1.4 : 0.6)));
    }, 800);
    return () => clearInterval(interval);
  }, [weeklyPlanRegenerating]);

  async function startWeeklyPlanRegeneration(token) {
    if (!token) return;
    setWeeklyPlanRegenerating(true);
    setWeeklyRegenProgress(6);
    setWeeklyRegenStep(0);
    setWeeklyRegenMessage('Pregătim planurile noi...');

    try {
      const response = await fetch('/api/user/regenerate-weekly-plan', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Nu am putut porni regenerarea planurilor.');
      }

      const reader = response.body?.getReader?.();
      if (!reader) throw new Error('Răspuns invalid de la server.');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);

          if (event.type === 'error') {
            throw new Error(event.message || 'Regenerarea planurilor a eșuat.');
          }

          if (event.type === 'progress') {
            if (typeof event.progress === 'number') {
              setWeeklyRegenProgress(prev => Math.max(prev, event.progress));
            }
            if (typeof event.day === 'number' && event.day > 0) {
              setWeeklyRegenStep(Math.min(7, event.day));
            }
            if (event.phase === 'workout') {
              setWeeklyRegenStep(7);
            }
            setWeeklyRegenMessage(event.message || 'Se generează planurile noi...');
          }

          if (event.type === 'complete') {
            setWeeklyRegenProgress(100);
            setWeeklyRegenStep(7);
            setWeeklyRegenMessage(event.message || 'Planurile noi sunt gata.');
          }
        }
      }

      await refreshClientData();
      await refreshWorkoutPlan(token);
      setMealsCompletedDays(0);
      setWorkoutCompletedDays(0);
      setCurrentPlanDay(0);
      setMealDayStatus({});
      setWorkoutDayStatus({});
    } catch (err) {
      setError(err.message || 'Regenerarea planurilor a eșuat.');
    } finally {
      setWeeklyPlanRegenerating(false);
      setLoading(false);
    }
  }
  startWeeklyPlanRegenerationRef.current = startWeeklyPlanRegeneration;

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

    // Fetch nivel XP (doar pt role:'user'; graceful pentru clienti antrenori)
    const tok2 = token;
    fetch('/api/user/level', { headers: { 'Authorization': `Bearer ${tok2}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.level) setUserLevel(data); })
      .catch(() => {});

    // Verifică reward pending de la onboarding
    try {
      const raw = localStorage.getItem('pendingOnboardingReward');
      if (raw) {
        localStorage.removeItem('pendingOnboardingReward');
        const reward = JSON.parse(raw);
        setTimeout(() => {
          fireConfetti();
          if (reward.type === 'levelUp') {
            setLevelUpReward({ fromLevel: reward.fromLevel, toLevel: reward.toLevel, levelInfo: reward.levelInfo });
          } else {
            setFinishReward({ type: 'onboarding', levelInfo: reward.levelInfo });
          }
        }, 600);
      }
    } catch { /* ignore */ }

    // Fetch lista planuri pentru client
    fetch('/api/meal-plans', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (!data.plans || data.plans.length === 0) {
          setError(null);
          setMealPlan(null);
          try { localStorage.setItem('noPlanUser', '1'); } catch {}
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
        try { localStorage.removeItem('noPlanUser'); } catch {}
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
        return fetch(`/api/user/cooldowns`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
      })
      .then(res => res ? res.json() : null)
      .then(data => {
        if (data?.mealsCooldownUntil && new Date(data.mealsCooldownUntil) > new Date()) {
          setMealsCooldownUntil(data.mealsCooldownUntil);
        }
        if (data?.workoutCooldownUntil && new Date(data.workoutCooldownUntil) > new Date()) {
          setWorkoutCooldownUntil(data.workoutCooldownUntil);
        }
        setMealsCompletedDays(Math.max(0, Math.min(7, Number(data?.mealsCompletedDays) || 0)));
        setWorkoutCompletedDays(Math.max(0, Math.min(7, Number(data?.workoutCompletedDays) || 0)));
        setCurrentPlanDay(Math.max(0, Math.min(7, Number(data?.currentPlanDay) || 0)));
        setMealDayStatus(data?.mealDayStatus || {});
        setWorkoutDayStatus(data?.workoutDayStatus || {});
        setStreakCount(Math.max(0, Number(data?.streakCount) || 0));
        setStreakState(data?.streakState === 'warning' ? 'warning' : 'normal');
        if (data?.weeklyPlanDue && !data?.weeklyPlanRegenerating) {
          startWeeklyPlanRegenerationRef.current?.(token);
          return;
        }
        setWeeklyPlanRegenerating(!!data?.weeklyPlanRegenerating);
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
    setMealsCooldownUntil(nextDate.toISOString());
    setWorkoutCooldownUntil(nextDate.toISOString());

    // Adauga 50 XP
    const previousLevelInfo = userLevel;
    fetch('/api/user/xp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ amount: 50 }),
    }).then(r => r.json()).then(data => {
      if (data.level) {
        setUserLevel(data);
        const levelUp = getLevelUpPayload(previousLevelInfo, data, data.xpAdded || 50);
        if (levelUp) {
          setLevelUpReward(levelUp);
          fireConfetti();
        }
      }
    }).catch(() => {});
    
    // Actualizează greutatea local imediat cu valoarea trimisă
    setClientData(prev => ({
      ...prev,
      weight: String(progressData.currentWeight)
    }));
    
    return { success: true };
  };

  const handleFinishDay = async (type, dayIndex = 0, previousLevelInfo = userLevel) => {
    const token = localStorage.getItem('token');
    if (!token) return null;
    // Optimistic: set cooldown to midnight
    const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
    if (type === 'meals') {
      setMealsCooldownUntil(midnight.toISOString());
      setMealsCompletedDays(prev => Math.min(7, Math.max(prev, dayIndex + 1)));
      setMealDayStatus(prev => ({ ...(prev || {}), [String(dayIndex)]: true }));
    }
    if (type === 'workout') {
      setWorkoutCooldownUntil(midnight.toISOString());
      setWorkoutCompletedDays(prev => Math.min(7, Math.max(prev, dayIndex + 1)));
      setWorkoutDayStatus(prev => ({ ...(prev || {}), [String(dayIndex)]: true }));
    }

    const optimisticLevel = previousLevelInfo ? getLevelInfoFromXp((Number(previousLevelInfo.totalXp) || 0) + 50) : null;
    if (optimisticLevel) {
      setUserLevel(optimisticLevel);
      const optimisticLevelUp = getLevelUpPayload(previousLevelInfo, optimisticLevel, 50);
      if (optimisticLevelUp) setPendingLevelUp(optimisticLevelUp);
    }

    try {
      const response = await fetch('/api/user/xp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ amount: 50, type, dayIndex }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Nu am putut finaliza ziua.');
      }
      if (data.level) {
        setUserLevel(data);
        const levelUp = getLevelUpPayload(previousLevelInfo, data, data.xpAdded || 50);
        if (levelUp) setPendingLevelUp(levelUp);
      }
      if (data.mealsCooldownUntil) setMealsCooldownUntil(data.mealsCooldownUntil);
      if (data.workoutCooldownUntil) setWorkoutCooldownUntil(data.workoutCooldownUntil);
      if (Number.isFinite(Number(data.mealsCompletedDays))) setMealsCompletedDays(Number(data.mealsCompletedDays));
      if (Number.isFinite(Number(data.workoutCompletedDays))) setWorkoutCompletedDays(Number(data.workoutCompletedDays));
      if (Number.isFinite(Number(data.currentPlanDay))) setCurrentPlanDay(Number(data.currentPlanDay));
      if (data.mealDayStatus) setMealDayStatus(data.mealDayStatus);
      if (data.workoutDayStatus) setWorkoutDayStatus(data.workoutDayStatus);
      if (Number.isFinite(Number(data.streakCount))) setStreakCount(Number(data.streakCount));
      if (data.streakState) setStreakState(data.streakState === 'warning' ? 'warning' : 'normal');
      return data;
    } catch (err) {
      if (optimisticLevel) setUserLevel(previousLevelInfo);
      setError(err.message || 'Nu am putut finaliza ziua.');
      return null;
    }
  };

  const firstName = user?.name?.split(' ')[0] || user?.name || '';
  const weeklyDoneCount =
    Object.values(mealDayStatus || {}).filter(Boolean).length +
    Object.values(workoutDayStatus || {}).filter(Boolean).length;
  const weeklyCompletionPct = Math.min(100, Math.round((weeklyDoneCount / 14) * 100));
  const finishRewardTitle = finishReward
    ? (finishReward.type === 'onboarding'
      ? 'Înregistrare finalizată!'
      : finishReward.type === 'meals'
      ? 'Mese finalizate'
      : finishReward.isRecovery
      ? 'Recuperare bifată'
      : 'Antrenament finalizat')
    : '';
  const finishRewardMessage = finishReward
    ? (finishReward.type === 'onboarding'
      ? 'Bine ai venit! Ai câștigat primii 50 XP pentru că ți-ai completat profilul.'
      : finishReward.type === 'meals'
      ? 'Bravo, ai închis ziua alimentar cum trebuie. +50 XP pentru consecvență.'
      : finishReward.isRecovery
      ? 'Foarte bine. Recuperarea contează la fel de mult ca efortul. +50 XP adăugați.'
      : 'Excelent. Ai dus antrenamentul până la capăt și ai câștigat +50 XP.')
    : '';
  const closeFinishReward = () => {
    setFinishReward(null);
    if (pendingLevelUp) {
      setLevelUpReward(pendingLevelUp);
      setPendingLevelUp(null);
      fireConfetti();
    }
  };

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
    if (knownNoPlan) {
      return (
        <div className={styles.container}>
          <div className={styles.mobileTopbar}>
            <div className={styles.mobileLogo}>
              <span style={{fontFamily:'var(--font-space-grotesk), var(--font-inter), sans-serif',fontWeight:700,fontSize:'20px',color:'#B7FF00',letterSpacing:'-0.5px'}}>trevano</span>
            </div>
          </div>
          <div className={styles.pageLayout}>
            <aside className={styles.sidebar}>
              <div className={styles.sidebarLogo}>
                <span style={{fontFamily:'var(--font-space-grotesk), var(--font-inter), sans-serif',fontWeight:700,fontSize:'20px',color:'#B7FF00',letterSpacing:'-0.5px'}}>trevano</span>
              </div>
            </aside>
            <main className={styles.main}>
              <div className={styles.dummyPlanScreen}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 400, width: '90%', textAlign: 'center' }}>
                  <p style={{ fontSize: 24, fontWeight: 800, color: '#0a0a0a', margin: 0, letterSpacing: '-0.6px' }}>Începe transformarea ta</p>
                  <p style={{ fontSize: 15, color: '#555', margin: 0, lineHeight: 1.65 }}>Urmează un plan creat pentru tine și fă primul pas chiar azi.</p>
                  <button
                    onClick={() => router.push('/generator-plan')}
                    style={{ background: '#0a0a0a', color: '#b7ff00', border: 'none', borderRadius: 14, padding: '16px 40px', fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 24px rgba(0,0,0,0.18)', letterSpacing: '-0.2px', transition: 'transform 0.15s, box-shadow 0.15s', marginTop: 8 }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.22)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)'; }}
                  >
                    Începe acum →
                  </button>
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
            {weeklyPlanRegenerating ? (
              <div className={styles.generationLoadingWrapper}>
                <div className={styles.generationLoadingBox}>
                  <p className={styles.generationLoadingTitle}>Se generează planurile noi</p>
                  <p className={styles.generationLoadingStep}>
                    {weeklyRegenMessage || 'Se pregătește planul alimentar...'}
                  </p>
                  <div className={styles.generationProgressTrack}>
                    <div className={styles.generationProgressFill} style={{ width: `${weeklyRegenProgress}%` }} />
                  </div>
                  <div className={styles.generationProgressDots}>
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <div
                        key={d}
                        className={`${styles.generationProgressDot} ${
                          d < weeklyRegenStep ? styles.generationProgressDotDone :
                          d === weeklyRegenStep ? styles.generationProgressDotActive : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
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
            )}
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
        {userLevel && (
          <div className={styles.mobileLevelPill}>
            <span className={styles.mobileLevelText}>💪 Nivel {userLevel.level}</span>
          </div>
        )}
        <div className={`${styles.mobileStreakPill} ${streakState === 'warning' ? styles.streakWarning : ''}`}>
          <span className={styles.mobileLevelText}>🔥 Streak {streakCount} Zile</span>
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
            {userLevel && (
              <div className={styles.sidebarLevelBlock}>
                <div className={styles.sidebarLevelRow}>
                  <span className={styles.sidebarLevelBadge}>💪 Nivel {userLevel.level}</span>
                  <span className={styles.sidebarLevelXp}>{userLevel.xpInCurrentLevel} / {userLevel.xpForNextLevel} XP</span>
                </div>
                <div className={styles.sidebarXpTrack}>
                  <div className={styles.sidebarXpFill} style={{ width: `${userLevel.progressPct}%` }} />
                </div>
              </div>
            )}
            <div className={`${styles.sidebarStreakBlock} ${streakState === 'warning' ? styles.streakWarning : ''}`}>
              <span>🔥 Streak</span>
              <strong>{streakCount} Zile</strong>
            </div>
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
        <main className={`${styles.main} ${(!mealPlan && !loading && !error) ? styles.mainNoScroll : ''}`}>
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
          {!progressFormOpen && !(!loading && !mealPlan && !error && activeTab === 'plan') && !(!loading && !workoutPlan && activeTab === 'workout') && (
          <div className={styles.planNavBlock}>
            <div className={styles.weekCompletionInline}>
              <div className={styles.weekCompletionTop}>
                <span>Săptămână completă</span>
                <strong>{weeklyCompletionPct}%</strong>
              </div>
              <div className={styles.weekCompletionTrack}>
                <div className={styles.weekCompletionFill} style={{ width: `${weeklyCompletionPct}%` }} />
              </div>
            </div>
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
          </div>
          )}

          {!loading && !mealPlan && !error && activeTab === 'plan' && (
            <div className={styles.dummyPlanScreen}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 400, width: '90%', textAlign: 'center' }}>
                <p style={{ fontSize: 24, fontWeight: 800, color: '#0a0a0a', margin: 0, letterSpacing: '-0.6px' }}>Începe transformarea ta</p>
                <p style={{ fontSize: 15, color: '#555', margin: 0, lineHeight: 1.65 }}>Urmează un plan creat pentru tine și fă primul pas chiar azi.</p>
                <button
                  onClick={() => router.push('/generator-plan')}
                  style={{ background: '#0a0a0a', color: '#b7ff00', border: 'none', borderRadius: 14, padding: '16px 40px', fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 24px rgba(0,0,0,0.18)', letterSpacing: '-0.2px', transition: 'transform 0.15s, box-shadow 0.15s', marginTop: 8 }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.22)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)'; }}
                >
                  Începe acum →
                </button>
              </div>
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
                  progressCooldownUntil={mealsCooldownUntil}
                  onProgressToggle={(open) => setProgressFormOpen(open)}
                  completedDays={mealsCompletedDays}
                  currentPlanDay={currentPlanDay}
                  dayStatus={mealDayStatus}
                  onFinishMeals={(dayIndex) => setConfirmFinish({ type: 'meals', dayIndex })}
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
              progressCooldownUntil={workoutCooldownUntil}
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
                progressCooldownUntil={workoutCooldownUntil}
                completedDays={workoutCompletedDays}
                currentPlanDay={currentPlanDay}
                dayStatus={workoutDayStatus}
                onFinishWorkout={(dayIndex, isRecovery) => setConfirmFinish({ type: 'workout', dayIndex, isRecovery })}
              />
            ) : (
              <div className={styles.dummyPlanScreen}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 400, width: '90%', textAlign: 'center' }}>
                  <p style={{ fontSize: 24, fontWeight: 800, color: '#0a0a0a', margin: 0, letterSpacing: '-0.6px' }}>Începe transformarea ta</p>
                  <p style={{ fontSize: 15, color: '#555', margin: 0, lineHeight: 1.65 }}>Urmează un plan creat pentru tine și fă primul pas chiar azi.</p>
                  <button
                    onClick={() => router.push('/generator-plan')}
                    style={{ background: '#0a0a0a', color: '#b7ff00', border: 'none', borderRadius: 14, padding: '16px 40px', fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 24px rgba(0,0,0,0.18)', letterSpacing: '-0.2px', transition: 'transform 0.15s, box-shadow 0.15s', marginTop: 8 }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.22)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)'; }}
                  >
                    Începe acum →
                  </button>
                </div>
              </div>
            )
          )}
          </>
          )}
        </main>
      </div>

      {confirmFinish && (
        <div className={clientStyles.modalOverlay} onClick={() => setConfirmFinish(null)}>
          <div className={clientStyles.confirmModal} onClick={e => e.stopPropagation()}>
            <div className={clientStyles.confirmIcon} style={{ background: 'rgba(10,10,10,0.07)', color: '#0a0a0a' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h3>{confirmFinish.type === 'meals' || confirmFinish.isRecovery ? 'Finalizare zi' : 'Finalizare antrenament'}</h3>
            <p>{confirmFinish.type === 'meals'
              ? 'Ești sigur că ai terminat de mâncat toate mesele de azi?'
              : (confirmFinish.isRecovery
                ? 'Ești sigur că ai completat recomandările pentru ziua de recuperare?'
                : 'Ești sigur că ai terminat antrenamentul de azi?')
            }</p>
            <div className={clientStyles.confirmActions}>
              <button className={clientStyles.cancelBtn} onClick={() => setConfirmFinish(null)}>Anulează</button>
              <button
                className={clientStyles.saveBtn}
                style={{ background: '#0a0a0a', color: '#b7ff00' }}
                onClick={() => {
                  const { type, dayIndex, isRecovery } = confirmFinish;
                  const previousLevelInfo = userLevel;
                  setConfirmFinish(null);
                  fireConfetti();
                  const optimisticLevel = previousLevelInfo ? getLevelInfoFromXp((Number(previousLevelInfo.totalXp) || 0) + 50) : null;
                  setFinishReward({ type, dayIndex, isRecovery, levelInfo: optimisticLevel });
                  handleFinishDay(type, dayIndex, previousLevelInfo).then((data) => {
                    if (!data) {
                      setFinishReward(null);
                      setPendingLevelUp(null);
                      return;
                    }
                    if (data.level) {
                      setFinishReward(prev => prev ? { ...prev, levelInfo: data } : prev);
                    }
                  });
                }}
              >
                Da, confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {finishReward && (
        <div className={clientStyles.modalOverlay} onClick={closeFinishReward}>
          <div className={`${clientStyles.confirmModal} ${styles.rewardModal}`} onClick={e => e.stopPropagation()}>
            <div className={styles.rewardIcon}>
              <span>{finishReward.type === 'onboarding' ? '🎉' : finishReward.type === 'meals' ? '💪' : '🔥'}</span>
            </div>
            <div className={styles.rewardXpBadge}>+50 XP</div>
            <h3>{finishRewardTitle}</h3>
            <p>{finishRewardMessage}</p>
            {(finishReward.levelInfo || userLevel) && (
              <div className={styles.rewardLevelLine}>
                Nivel {(finishReward.levelInfo || userLevel).level}
                <span>{(finishReward.levelInfo || userLevel).xpInCurrentLevel} / {(finishReward.levelInfo || userLevel).xpForNextLevel} XP</span>
              </div>
            )}
            <div className={clientStyles.confirmActions}>
              <button
                className={clientStyles.saveBtn}
                style={{ background: '#0a0a0a', color: '#b7ff00', width: '100%' }}
                onClick={closeFinishReward}
              >
                Super, merg mai departe
              </button>
            </div>
          </div>
        </div>
      )}

      {levelUpReward && !finishReward && (
        <div className={clientStyles.modalOverlay} onClick={() => setLevelUpReward(null)}>
          <div className={`${clientStyles.confirmModal} ${styles.rewardModal} ${styles.levelUpModal}`} onClick={e => e.stopPropagation()}>
            <div className={styles.rewardIcon}>
              <span>💪</span>
            </div>
            <div className={styles.rewardXpBadge}>LEVEL UP</div>
            <h3>Nivel {levelUpReward.toLevel}</h3>
            <p>Excelent. Ai trecut de la nivelul {levelUpReward.fromLevel} la nivelul {levelUpReward.toLevel}. Se vede consecvența.</p>
            <div className={styles.rewardLevelLine}>
              Nivel {levelUpReward.levelInfo.level}
              <span>{levelUpReward.levelInfo.xpInCurrentLevel} / {levelUpReward.levelInfo.xpForNextLevel} XP</span>
            </div>
            <div className={clientStyles.confirmActions}>
              <button
                className={clientStyles.saveBtn}
                style={{ background: '#0a0a0a', color: '#b7ff00', width: '100%' }}
                onClick={() => setLevelUpReward(null)}
              >
                Continuă
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClientDashboard() {
  return (
    <ProtectedRoute requiredRole={['client', 'user']}>
      <ClientDashboardContent />
    </ProtectedRoute>
  );
}
