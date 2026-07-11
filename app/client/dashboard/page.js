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

const fireSmallConfetti = async () => {
  const confetti = (await import('canvas-confetti')).default;
  confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 }, colors: ['#b7ff00', '#0a0a0a', '#ffffff'], zIndex: 9999 });
};

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

function getLevelEmoji(level) {
  const safeLevel = Math.max(1, Number(level) || 1);
  if (safeLevel <= 2) return '🚶';
  if (safeLevel <= 5) return '🏃';
  if (safeLevel <= 10) return '🏋️';
  if (safeLevel <= 15) return '💪';
  if (safeLevel <= 20) return '🏅';
  return '🏆';
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

const WORKOUT_FOCUS_COPY = {
  push: {
    title: 'Push',
    description: 'Sesiune pentru piept, umeri și triceps, cu accent pe împins controlat, volum eficient și execuții curate.',
  },
  pull: {
    title: 'Pull',
    description: 'Antrenament construit pentru spate și biceps, cu mișcări de tracțiune care adaugă densitate și control.',
  },
  legs: {
    title: 'Legs',
    description: 'Zi de picioare completă, gândită pentru forță, stabilitate și volum pe lanțul inferior.',
  },
  upper: {
    title: 'Upper Body',
    description: 'Focus pe partea superioară a corpului, cu un mix echilibrat de împins, tras și lucru pentru brațe.',
  },
  lower: {
    title: 'Lower Body',
    description: 'Sesiune pentru picioare și fesieri, cu ritm atent, control postural și volum bine dozat.',
  },
  fullBody: {
    title: 'Full Body',
    description: 'Antrenament complet, compact și echilibrat, care atinge principalele grupe musculare într-o singură sesiune.',
  },
  chest: {
    title: 'Piept',
    description: 'Sesiune dedicată pieptului, cu exerciții alese pentru tensiune bună, amplitudine și progres vizibil.',
  },
  back: {
    title: 'Spate',
    description: 'Antrenament pentru spate, orientat spre tracțiuni, ramat și control scapular.',
  },
  shoulders: {
    title: 'Umeri',
    description: 'Sesiune concentrată pe umeri, cu accent pe deltoizi, stabilitate și linii curate ale execuției.',
  },
  arms: {
    title: 'Brațe',
    description: 'Antrenament pentru biceps și triceps, cu volum direct și pauze potrivite pentru pompare controlată.',
  },
  core: {
    title: 'Core',
    description: 'Sesiune pentru abdomen și stabilitate, cu mișcări care susțin postura și controlul întregului corp.',
  },
};

function getWorkoutFocusCopy(focus, exercises = []) {
  if (WORKOUT_FOCUS_COPY[focus]) return WORKOUT_FOCUS_COPY[focus];

  const muscles = exercises
    .map(ex => ex.muscleGroup || ex.muscle)
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);

  if (muscles.length === 1) {
    return {
      title: muscles[0],
      description: `Sesiune dedicată pentru ${muscles[0].toLowerCase()}, cu exerciții alese pentru volum, control și progres constant.`,
    };
  }

  if (muscles.length > 1) {
    return {
      title: muscles.slice(0, 2).join(' + '),
      description: `Antrenament echilibrat pentru ${muscles.slice(0, 3).join(', ').toLowerCase()}, construit ca să lucrezi eficient grupele importante ale zilei.`,
    };
  }

  return {
    title: 'Sesiunea de azi',
    description: 'Antrenament calibrat pentru planul tău curent, cu exerciții selectate pentru o sesiune clară și eficientă.',
  };
}

function WorkoutButtonIcon() {
  return (
    <svg className={styles.buttonIcon} width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
    </svg>
  );
}

function CoinAmount({ amount = 0, compact = false }) {
  return (
    <span className={`${styles.coinAmount} ${compact ? styles.coinAmountCompact : ''}`}>
      <span className={styles.coinIcon} aria-hidden="true" />
      <strong>{amount}</strong>
    </span>
  );
}

function LevelLabel({ level }) {
  return (
    <>
      <span className={styles.levelEmoji} aria-hidden="true">{getLevelEmoji(level)}</span>
      <span>Nivel {level}</span>
    </>
  );
}

function normalizeInstructionList(instructions) {
  if (!instructions) return [];
  if (Array.isArray(instructions)) {
    return instructions.map(item => String(item || '').trim()).filter(Boolean);
  }
  return String(instructions)
    .split(/\r?\n/)
    .map(item => item.replace(/^[-•\d.)\s]+/, '').trim())
    .filter(Boolean);
}

function getMealImageUrl(meal = {}) {
  return String(meal.imageUrl || meal.image_url || '').trim();
}

function getMealImageFallbackUrl(meal = {}) {
  return String(meal.imageFallbackUrl || meal.image_fallback_url || '').trim();
}

function getTodayFirstMealImage(plan, currentPlanDay) {
  const days = Array.isArray(plan?.days) ? plan.days : [];
  if (!days.length) return null;

  const dayIndex = Math.max(0, Math.min(days.length - 1, Number(currentPlanDay) || 0));
  const meals = Array.isArray(days[dayIndex]?.meals) ? days[dayIndex].meals : [];
  const meal = meals.find(item => getMealImageUrl(item));
  if (!meal) return null;

  return {
    url: getMealImageUrl(meal),
    fallbackUrl: getMealImageFallbackUrl(meal),
  };
}

function ClientDashboardContent() {
  const router = useRouter();
  const { logout, user, login } = useAuth();
  const [loading, setLoading] = useState(true);
  const [mealPlan, setMealPlan] = useState(null);
  const [confirmedNoMealPlan, setConfirmedNoMealPlan] = useState(false);
  const [confirmedNoWorkoutPlan, setConfirmedNoWorkoutPlan] = useState(false);
  const [clientData, setClientData] = useState(null);
  const [nutritionalNeeds, setNutritionalNeeds] = useState(null);
  const [workoutPlan, setWorkoutPlan] = useState(null);
  const [workoutClientData, setWorkoutClientData] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mealsCooldownUntil, setMealsCooldownUntil] = useState(null);
  const [workoutCooldownUntil, setWorkoutCooldownUntil] = useState(null);
  const [mealsCompletedDays, setMealsCompletedDays] = useState(0);
  const [workoutCompletedDays, setWorkoutCompletedDays] = useState(0);
  const [currentPlanDay, setCurrentPlanDay] = useState(0);
  const [mealDayStatus, setMealDayStatus] = useState({});
  const [workoutDayStatus, setWorkoutDayStatus] = useState({});
  const [waterMl, setWaterMl] = useState(0);
  const [waterLoaded, setWaterLoaded] = useState(false);
  const [waterSaving, setWaterSaving] = useState(false);
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
  const enrichedMealPlanLoadedRef = useRef(false);
  const preloadedTodayMealImageRef = useRef('');
  const startWeeklyPlanRegenerationRef = useRef(null);

  // ── Workout Session SPA ──────────────────────────────────────────────────
  // null | {phase:'loading'} | {phase:'active', focus, exercises, currentIndex, xpEarned, elapsedSeconds, startedAt}
  // | {phase:'done', focus, totalXp, elapsedSeconds, exerciseCount}
  const [workoutSession, setWorkoutSession] = useState(null);
  // null | { exercises, focus } — shown before timer starts (pre-flight)
  const [workoutStartScreen, setWorkoutStartScreen] = useState(null);
  // true when a paused session exists in DB (shows "Continuă" button)
  const [hasActivePausedSession, setHasActivePausedSession] = useState(false);
  const [confirmAbandonWorkout, setConfirmAbandonWorkout] = useState(false);
  const [xpToast, setXpToast] = useState(null);       // { amount } | null
  const [xpFinishPopup, setXpFinishPopup] = useState(null); // { totalXp, elapsedSeconds, exerciseCount } | null
  const [loadedWorkoutVideos, setLoadedWorkoutVideos] = useState({});
  // Wall-clock timer: Date.now() at last start/resume
  const timerStartedAtRef = useRef(null);
  // Accumulated seconds before current segment
  const timerBaseRef = useRef(0);

  // XP / Nivel
  const [userLevel, setUserLevel] = useState(null); // { level, totalXp, xpInCurrentLevel, xpForNextLevel, progressPct }
  // Confirm finish modal: null | { type: 'meals' | 'workout', dayIndex: number, isRecovery?: boolean }
  const [confirmFinish, setConfirmFinish] = useState(null);

  const [finishReward, setFinishReward] = useState(null);
  const [pendingLevelUp, setPendingLevelUp] = useState(null);
  const [levelUpReward, setLevelUpReward] = useState(null);

  const applyUserPlansSnapshot = (profileData) => {
    if (!profileData?.client) return false;

    const c = profileData.client;
    if (profileData.mealPlan?.plan_data) {
      enrichedMealPlanLoadedRef.current = true;
      setConfirmedNoMealPlan(false);
      setMealPlan(profileData.mealPlan.plan_data);
      setNutritionalNeeds(profileData.mealPlan.daily_targets || null);
    }
    if (profileData.workoutPlan?.plan_data) {
      setConfirmedNoWorkoutPlan(false);
      setWorkoutPlan(profileData.workoutPlan.plan_data);
    }

    setClientData({
      clientId: c.id,
      name: c.name || 'Tu',
      age: c.age ? String(c.age) : undefined,
      weight: c.weight ? String(c.weight) : undefined,
      height: c.height ? String(c.height) : undefined,
      gender: c.gender,
      goal: c.goal,
      activityLevel: c.activity_level,
      dietType: c.diet_type,
      allergies: c.allergies,
      mealsPerDay: c.meals_per_day ? String(c.meals_per_day) : undefined,
      hydrationTargetMl: c.hydration_target_ml,
      foodPreferences: c.food_preferences || '',
    });
    return true;
  };

  const fetchUserPlansSnapshot = async (token) => {
    const response = await fetch('/api/user/plans', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return response.json();
  };

  useEffect(() => {
    if (activeTab === 'plan') return undefined;

    const image = getTodayFirstMealImage(mealPlan, currentPlanDay);
    if (!image?.url || preloadedTodayMealImageRef.current === image.url) return undefined;

    preloadedTodayMealImageRef.current = image.url;
    const preloadImage = new Image();
    preloadImage.decoding = 'async';
    preloadImage.fetchPriority = 'high';
    preloadImage.onerror = () => {
      if (image.fallbackUrl && preloadImage.src !== image.fallbackUrl) {
        preloadImage.src = image.fallbackUrl;
      }
    };
    preloadImage.src = image.url;

    return undefined;
  }, [activeTab, currentPlanDay, mealPlan]);

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
      const profileData = await fetchUserPlansSnapshot(token);
      const profileApplied = applyUserPlansSnapshot(profileData);

      // Fetch lista planuri pentru client
      const plansRes = await fetch('/api/meal-plans', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const plansData = await plansRes.json();
      
      if (!plansData.plans || plansData.plans.length === 0) {
        if (!profileApplied) setMealPlan(null);
        setConfirmedNoMealPlan(!profileData?.mealPlan);
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
        
        // /api/user/plans aduce planul îmbogățit cu imagini; legacy detail e fallback.
        if (!profileData?.mealPlan?.plan_data) {
          setMealPlan(plan_data);
          setNutritionalNeeds(daily_targets);
        }
        
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
          hydrationTargetMl: c.hydration_target_ml,
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
          setConfirmedNoWorkoutPlan(true);
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
        setConfirmedNoWorkoutPlan(false);
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

    // Check for active/paused workout session in DB — only show Continuă button
    fetch('/api/user/workout-session', { headers: { 'Authorization': `Bearer ${tok2}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.activeSession) setHasActivePausedSession(true); })
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

    const profilePromise = fetchUserPlansSnapshot(token)
      .then(profileData => {
        if (applyUserPlansSnapshot(profileData)) {
          setError(null);
        }
        return profileData;
      })
      .catch(() => null);

    // Fetch lista planuri pentru client
    fetch('/api/meal-plans', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (!data.plans || data.plans.length === 0) {
          setError(null);
          profilePromise
            .then(profileData => {
              if (profileData?.mealPlan?.plan_data) {
                setConfirmedNoMealPlan(false);
              } else {
                setMealPlan(null);
                setConfirmedNoMealPlan(true);
              }
            })
            .finally(() => setLoading(false));
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
          profilePromise.finally(() => setLoading(false));
          return;
        }

        const { plan_data, daily_targets, client_id } = data.mealPlan;
        setConfirmedNoMealPlan(false);
        if (!enrichedMealPlanLoadedRef.current) {
          setMealPlan(plan_data);
          setNutritionalNeeds(daily_targets);
        }
        
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
          hydrationTargetMl: c.hydration_target_ml,
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

  // ── Wall-clock workout timer ─────────────────────────────────────────────
  useEffect(() => {
    if (workoutSession?.phase !== 'active') return;
    const tick = () => {
      if (!timerStartedAtRef.current) return;
      const live = timerBaseRef.current + Math.floor((Date.now() - timerStartedAtRef.current) / 1000);
      setWorkoutSession(prev => prev?.phase === 'active' ? { ...prev, elapsedSeconds: live } : prev);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [workoutSession?.phase]);

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
      body: JSON.stringify({ amount: 50, type: 'progress_update' }),
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
  const todayKey = String(currentPlanDay);
  const mealsDoneToday = mealDayStatus?.[todayKey] === true;
  const workoutDoneToday = workoutDayStatus?.[todayKey] === true;
  const hydrationTargetMl = Number(clientData?.hydrationTargetMl) || null;
  const hydrationTargetLoaded = Number.isFinite(hydrationTargetMl) && hydrationTargetMl > 0;
  const hydrationTargetLiters = hydrationTargetLoaded ? (hydrationTargetMl / 1000).toLocaleString('ro-RO', {
    maximumFractionDigits: 2,
  }) : null;
  const workoutStartCopy = workoutStartScreen
    ? getWorkoutFocusCopy(workoutStartScreen.focus, workoutStartScreen.exercises || [])
    : null;
  const workoutStartMuscles = workoutStartScreen
    ? (workoutStartScreen.exercises || [])
      .map(ex => ex.muscleGroup || ex.muscle)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, 4)
      .join(' · ')
    : '';
  const workoutStartExerciseCount = workoutStartScreen
    ? Number(workoutStartScreen.exerciseCount) || (workoutStartScreen.exercises || []).length || 0
    : 0;
  const workoutPreloadVideoUrls = workoutStartScreen
    ? [...new Set((workoutStartScreen.exercises || []).map(ex => ex.videoUrl).filter(Boolean))]
    : [];
  const waterDoneToday = hydrationTargetLoaded && waterLoaded && waterMl >= hydrationTargetMl;
  const hasWorkoutInProgress = hasActivePausedSession || workoutSession?.phase === 'active';
  const dayDoneToday = workoutDoneToday && mealsDoneToday && waterDoneToday;
  const todayMissionDoneCount = [workoutDoneToday, mealsDoneToday, waterDoneToday, dayDoneToday].filter(Boolean).length;
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

  useEffect(() => {
    let cancelled = false;

    async function loadDailyWater() {
      setWaterLoaded(false);
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('Token lipsă.');

        const response = await fetch('/api/user/daily-progress', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Nu am putut citi apa de azi.');

        if (!cancelled) setWaterMl(Math.max(0, Number(data.waterMl) || 0));
      } catch (err) {
        console.error('Daily water sync load failed:', err);
        if (!cancelled) setWaterMl(0);
      } finally {
        if (!cancelled) setWaterLoaded(true);
      }
    }

    loadDailyWater();
    return () => { cancelled = true; };
  }, [user?.id]);
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
  const handleAddWater = async () => {
    if (!hydrationTargetLoaded || !waterLoaded || waterSaving || waterDoneToday) return;

    const previous = waterMl;
    const next = Math.min(hydrationTargetMl, previous + 250);
    setWaterMl(next);
    setWaterSaving(true);

    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Token lipsă.');

      const response = await fetch('/api/user/daily-progress', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ waterMl: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut salva apa de azi.');
      setWaterMl(Math.max(0, Number(data.waterMl) || next));
    } catch (err) {
      console.error('Daily water sync save failed:', err);
      setWaterMl(previous);
    } finally {
      setWaterSaving(false);
    }
  };

  const openMealPlan = () => {
    if (!mealPlan) {
      router.push('/generator-plan');
      return;
    }
    handleTabChange('plan');
  };

  const openWorkoutPlan = () => {
    if (hasActivePausedSession) {
      handleStartWorkoutSession();
      return;
    }
    if (workoutPlan) {
      handleTabChange('workout');
      return;
    }
    handleStartWorkoutSession();
  };

  const renderMissionBullet = (done) => (
    <span className={`${styles.journeyBullet} ${done ? styles.journeyBulletDone : ''}`}>
      {done ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : null}
    </span>
  );

  const renderJourneyDashboard = () => (
    <div className={`${styles.dummyPlanScreen} ${styles.dummyPlanScreenDash}`}>
      <div className={styles.journeyLayout}>
        <section className={styles.journeyPanel}>
          <div className={styles.journeyPanelHead}>
            <span className={styles.journeyPanelLabel}>Misiunile de azi</span>
            <span className={styles.journeyPanelCount}>{todayMissionDoneCount}<small>/4</small></span>
          </div>
          <div className={styles.journeyMissionRows}>
            <div className={styles.journeyMissionRow}>
              {renderMissionBullet(workoutDoneToday)}
              <span className={`${styles.journeyMissionText} ${workoutDoneToday ? styles.journeyMissionTextDone : ''}`}>
                Finalizează antrenamentul
              </span>
            </div>
            <div className={styles.journeyMissionRow}>
              {renderMissionBullet(mealsDoneToday)}
              <span className={`${styles.journeyMissionText} ${mealsDoneToday ? styles.journeyMissionTextDone : ''}`}>
                Respectă mesele zilei
              </span>
            </div>
            <div className={styles.journeyMissionRow}>
              {renderMissionBullet(waterDoneToday)}
              <span className={`${styles.journeyMissionText} ${waterDoneToday ? styles.journeyMissionTextDone : ''}`}>
                {hydrationTargetLoaded ? `Bea ${hydrationTargetLiters} L apă` : 'Încarcă targetul de apă'}
              </span>
            </div>
            <div className={styles.journeyMissionRow}>
              {renderMissionBullet(dayDoneToday)}
              <span className={`${styles.journeyMissionText} ${dayDoneToday ? styles.journeyMissionTextDone : ''}`}>
                Finalizează ziua
              </span>
            </div>
          </div>
        </section>

        <section>
          <div className={styles.journeyCards}>
            <article className={`${styles.jCard} ${workoutDoneToday ? styles.jCardDone : ''}`}>
              <h2 className={styles.jCardTitle}>Antrenament</h2>
              <p className={styles.jCardSub}>
                {workoutDoneToday ? 'Antrenamentul de azi este bifat.' : hasActivePausedSession ? 'Ai un antrenament început.' : 'Pornește sesiunea de azi.'}
              </p>
              <div className={styles.jCardFoot}>
                {workoutDoneToday ? (
                  <span className={styles.jCardStatusDone}>✓ Finalizat</span>
                ) : (
                  <button className={styles.jCardGenBtn} onClick={openWorkoutPlan}>
                    {hasActivePausedSession ? (
                      <>
                        <WorkoutButtonIcon />
                        Continuă
                      </>
                    ) : workoutPlan ? 'Deschide' : (
                      <>
                        <WorkoutButtonIcon />
                        Începe
                      </>
                    )}
                  </button>
                )}
              </div>
            </article>

            <article className={`${styles.jCard} ${mealsDoneToday ? styles.jCardDone : ''}`}>
              <h2 className={styles.jCardTitle}>Mese</h2>
              <p className={styles.jCardSub}>
                {mealsDoneToday ? 'Ai închis ziua alimentar.' : 'Vezi mesele zilei.'}
              </p>
              <div className={styles.jCardFoot}>
                {mealsDoneToday ? (
                  <span className={styles.jCardStatusDone}>✓ Finalizat</span>
                ) : (
                  <button className={styles.jCardGenBtn} onClick={openMealPlan}>
                    Vezi mesele
                  </button>
                )}
              </div>
            </article>

            <article className={`${styles.jCard} ${waterDoneToday ? styles.jCardDone : ''}`}>
              <h2 className={styles.jCardTitle}>Apă</h2>
              <p className={styles.jCardSub}>
                {hydrationTargetLoaded && waterLoaded
                  ? `${waterMl} / ${hydrationTargetMl} ml azi`
                  : 'Se încarcă progresul de apă...'}
              </p>
              <div className={styles.jCardFoot}>
                <div className={styles.jCardWaterRow}>
                  <div className={styles.jCardWaterTrack}>
                    <div
                      className={`${styles.jCardWaterFill} ${waterDoneToday ? styles.jCardWaterFillDone : ''}`}
                      style={{ width: `${hydrationTargetLoaded && waterLoaded ? Math.min(100, Math.round((waterMl / hydrationTargetMl) * 100)) : 0}%` }}
                    />
                  </div>
                  <button className={styles.jCardWaterBtn} onClick={handleAddWater} disabled={!hydrationTargetLoaded || !waterLoaded || waterSaving || waterDoneToday}>
                    {waterSaving ? '...' : '+250ml'}
                  </button>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
  );

  // ── Workout Session handlers ─────────────────────────────────────────────
  const handleStartWorkoutSession = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setError(null);
    setWorkoutSession({ phase: 'loading' });
    try {
      // Check for existing paused session in DB
      const sessionRes = await fetch('/api/user/workout-session', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json().catch(() => null);
        if (sessionData?.activeSession) {
          const s = sessionData.activeSession;
          timerBaseRef.current = s.elapsedSeconds || 0;
          timerStartedAtRef.current = Date.now();
          setHasActivePausedSession(false);
          setWorkoutSession({
            phase: 'active',
            focus: s.focus,
            workoutDayIndex: s.workoutDayIndex,
            exercises: s.exercises,
            currentIndex: s.currentIndex || 0,
            xpEarned: s.xpEarned || 0,
            elapsedSeconds: s.elapsedSeconds || 0,
            startedAt: s.startedAt,
          });
          return;
        }
      }
      // No existing session — fetch only today's theme from the user's split
      const focusRes = await fetch('/api/user/workout-session?focus=auto&preview=1', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!focusRes.ok) {
        const focusError = await focusRes.json().catch(() => null);
        setError(focusError?.error || 'Nu am putut pregăti antrenamentul.');
        setWorkoutSession(null);
        return;
      }
      const focusData = await focusRes.json().catch(() => null);
      if (!focusData?.focus) {
        setError('Nu am putut pregăti tematica antrenamentului.');
        setWorkoutSession(null);
        return;
      }
      // Show pre-flight start screen
      setWorkoutSession(null);
      setWorkoutStartScreen({
        focus: focusData.focus,
        trainingSplit: focusData.trainingSplit,
        workoutDayIndex: focusData.workoutDayIndex,
        exerciseCount: focusData.exerciseCount,
      });
    } catch {
      setWorkoutSession(null);
    }
  };

  const handleStartActualSession = async () => {
    if (!workoutStartScreen) return;
    const { focus } = workoutStartScreen;
    const token = localStorage.getItem('token');
    let session = null;
    if (token) {
      const response = await fetch('/api/user/workout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ focus, generate: true }),
        })
        .catch(() => null);
      if (!response?.ok) {
        const data = await response?.json().catch(() => null);
        setError(data?.error || 'Nu am putut porni antrenamentul.');
        setWorkoutStartScreen(null);
        return;
      }
      const data = await response.json().catch(() => null);
      session = data?.session || null;
    }
    const exercises = session?.exercises || [];
    if (!exercises.length) {
      setError('Nu am putut genera exercițiile pentru antrenament.');
      setWorkoutStartScreen(null);
      return;
    }
    timerBaseRef.current = 0;
    timerStartedAtRef.current = Date.now();
    setWorkoutStartScreen(null);
    setHasActivePausedSession(false);
    setWorkoutSession({
      phase: 'active',
      focus: session?.focus || focus,
      workoutDayIndex: session?.workoutDayIndex ?? workoutStartScreen.workoutDayIndex,
      exercises,
      currentIndex: 0,
      xpEarned: 0,
      elapsedSeconds: 0,
      startedAt: new Date().toISOString(),
    });
  };

  const handleExerciseDone = () => {
    const token = localStorage.getItem('token');
    const liveElapsed = timerBaseRef.current +
      Math.floor((Date.now() - (timerStartedAtRef.current || Date.now())) / 1000);

    setWorkoutSession(prev => {
      if (!prev || prev.phase !== 'active') return prev;
      const nextIndex = prev.currentIndex + 1;
      const newXp = (prev.xpEarned || 0) + 15;
      if (token) {
        fetch('/api/user/workout-session', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ currentIndex: nextIndex, xpEarned: newXp, elapsedSeconds: liveElapsed }),
        }).catch(() => {});
      }
      if (nextIndex >= prev.exercises.length) {
        return {
          phase: 'done',
          focus: prev.focus,
          workoutDayIndex: prev.workoutDayIndex,
          totalXp: newXp,
          elapsedSeconds: liveElapsed,
          exerciseCount: prev.exercises.length,
        };
      }
      return { ...prev, currentIndex: nextIndex, xpEarned: newXp, elapsedSeconds: liveElapsed };
    });

    setXpToast({ amount: 15 });
    setTimeout(() => setXpToast(null), 1800);
    fireSmallConfetti();

    if (token) {
      fetch('/api/user/xp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ amount: 15, type: 'exercise' }),
      }).then(r => r.json()).then(data => { if (data?.level) setUserLevel(data); }).catch(() => {});
    }
  };

  const handleFinalizeWorkout = () => {
    if (workoutSession?.phase !== 'done') return;
    const token = localStorage.getItem('token');
    const { totalXp, elapsedSeconds, exerciseCount, workoutDayIndex } = workoutSession;

    if (token) {
      fetch('/api/user/workout-session', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => {});
    }

    setWorkoutSession(null);
    setHasActivePausedSession(false);
    setXpFinishPopup({ totalXp, elapsedSeconds, exerciseCount });
    fireConfetti();

    if (token) {
      const previousLevelInfo = userLevel;
      fetch('/api/user/xp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ amount: 50, type: 'workout', dayIndex: workoutDayIndex ?? currentPlanDay }),
      }).then(r => r.json()).then(data => {
        if (data?.level) {
          setUserLevel(data);
          const levelUp = getLevelUpPayload(previousLevelInfo, data, 50);
          if (levelUp) setPendingLevelUp(levelUp);
        }
        if (data?.workoutCooldownUntil) setWorkoutCooldownUntil(data.workoutCooldownUntil);
        if (Number.isFinite(Number(data?.workoutCompletedDays))) setWorkoutCompletedDays(Number(data.workoutCompletedDays));
        if (Number.isFinite(Number(data?.currentPlanDay))) setCurrentPlanDay(Number(data.currentPlanDay));
        if (data?.workoutDayStatus) setWorkoutDayStatus(data.workoutDayStatus);
      }).catch(() => {});
    }
  };

  const handleAbandonWorkout = () => {
    setConfirmAbandonWorkout(true);
  };

  const confirmAbandonCurrentWorkout = () => {
    const token = localStorage.getItem('token');
    if (token) {
      fetch('/api/user/workout-session', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      }).catch(() => {});
    }
    setWorkoutSession(null);
    setWorkoutStartScreen(null);
    setHasActivePausedSession(false);
    setConfirmAbandonWorkout(false);
    setActiveTab('home');
    timerStartedAtRef.current = null;
    timerBaseRef.current = 0;
  };

  // Format seconds as MM:SS
  const fmtTime = (secs) => {
    const s = Math.max(0, Math.floor(secs || 0));
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

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
    <>
    <div className={styles.container}>
      <div className={styles.mobileTopbar}>
        <button className={styles.hamburger} onClick={() => setSidebarOpen(v => !v)} aria-label="Meniu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        {userLevel && (
          <div className={styles.mobileLevelPill}>
            <div className={styles.mobileLevelTop}>
              <span className={styles.mobileLevelText}><LevelLabel level={userLevel.level} /></span>
              <span className={styles.mobileXpText}>{userLevel.xpInCurrentLevel}/{userLevel.xpForNextLevel} XP</span>
            </div>
            <div className={styles.mobileXpTrack}>
              <div className={styles.mobileXpFill} style={{ width: `${userLevel.progressPct}%` }} />
            </div>
          </div>
        )}
        {userLevel && (
          <div className={styles.mobileCoinPill}>
            <CoinAmount amount={userLevel.appCoins || 0} compact />
          </div>
        )}
        <div className={`${styles.mobileStreakPill} ${streakState === 'warning' ? styles.streakWarning : ''}`}>
          <span className={styles.mobileLevelText}>🔥 {streakCount}</span>
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
                  <span className={styles.sidebarLevelBadge}><LevelLabel level={userLevel.level} /></span>
                  <span className={styles.sidebarLevelXp}>{userLevel.xpInCurrentLevel} / {userLevel.xpForNextLevel} XP</span>
                </div>
                <div className={styles.sidebarXpTrack}>
                  <div className={styles.sidebarXpFill} style={{ width: `${userLevel.progressPct}%` }} />
                </div>
              </div>
            )}
            {userLevel && (
              <div className={styles.sidebarCoinBlock}>
                <CoinAmount amount={userLevel.appCoins || 0} />
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

          {/* ── Workout Loading ───────────────────────────────────── */}
          {workoutSession?.phase === 'loading' && (
            <div className={styles.wsWrap}>
              <div className={styles.wsLoading}>
                <div className={styles.loadingSpinner} />
                <p>Se pregătește antrenamentul...</p>
              </div>
            </div>
          )}

          {/* ── Workout Start Screen (pre-flight) ─────────────────── */}
          {workoutStartScreen && !workoutSession && (
            <div className={styles.workoutStartWrap}>
              {workoutPreloadVideoUrls.length > 0 && (
                <div className={styles.workoutVideoPreloadBank} aria-hidden="true">
                  {workoutPreloadVideoUrls.map(url => (
                    <video
                      key={url}
                      src={url}
                      muted
                      playsInline
                      preload="auto"
                      onLoadedData={() => {
                        setLoadedWorkoutVideos(prev => prev[url] ? prev : { ...prev, [url]: true });
                      }}
                    />
                  ))}
                </div>
              )}
              <button className={styles.workoutStartBack} onClick={() => setWorkoutStartScreen(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
                Înapoi
              </button>
              <div className={styles.workoutStartCard}>
                <h2 className={styles.workoutStartTitle}>{workoutStartCopy?.title}</h2>
                {workoutStartMuscles && (
                  <p className={styles.workoutStartMuscles}>{workoutStartMuscles}</p>
                )}
                <p className={styles.workoutStartDesc}>
                  {workoutStartCopy?.description}
                </p>
                <div className={styles.workoutStartMeta}>
                  <div className={styles.workoutStartMetaItem}>
                    <span className={styles.workoutStartMetaVal}>{workoutStartExerciseCount}</span>
                    <span className={styles.workoutStartMetaLbl}>Exerciții</span>
                  </div>
                  <div className={styles.workoutStartMetaDivider} />
                  <div className={styles.workoutStartMetaItem}>
                    <span className={styles.workoutStartMetaVal}>+{workoutStartExerciseCount * 15}</span>
                    <span className={styles.workoutStartMetaLbl}>XP posibil</span>
                  </div>
                  <div className={styles.workoutStartMetaDivider} />
                  <div className={styles.workoutStartMetaItem}>
                    <span className={styles.workoutStartMetaVal}>~{Math.round(workoutStartExerciseCount * 4)}</span>
                    <span className={styles.workoutStartMetaLbl}>Min</span>
                  </div>
                </div>
                <button className={styles.workoutStartBtn} onClick={handleStartActualSession}>
                  <WorkoutButtonIcon />
                  Începe antrenament
                </button>
              </div>
            </div>
          )}

          {/* ── Active Workout Session ─────────────────────────────── */}
          {workoutSession?.phase === 'active' && (() => {
            const ex = workoutSession.exercises[workoutSession.currentIndex];
            const videoReady = !!(ex?.videoUrl && loadedWorkoutVideos[ex.videoUrl]);
            const exerciseInstructions = normalizeInstructionList(ex?.instructions);
            const progressPct = Math.round((workoutSession.currentIndex / workoutSession.exercises.length) * 100);
            return (
              <div className={styles.wsWrap}>
                <div className={styles.wsHeader}>
                  <button className={styles.wsBackBtn} onClick={() => {
                    // Save elapsed to DB before hiding UI
                    const liveElapsed = timerBaseRef.current +
                      Math.floor((Date.now() - (timerStartedAtRef.current || Date.now())) / 1000);
                    const tokPause = localStorage.getItem('token');
                    if (tokPause) {
                      fetch('/api/user/workout-session', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokPause}` },
                        body: JSON.stringify({
                          currentIndex: workoutSession.currentIndex,
                          xpEarned: workoutSession.xpEarned ?? 0,
                          elapsedSeconds: liveElapsed,
                        }),
                      }).catch(() => {});
                    }
                    timerStartedAtRef.current = null;
                    timerBaseRef.current = liveElapsed;
                    setHasActivePausedSession(true);
                    setWorkoutSession(null);
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                    Înapoi
                  </button>
                  <span className={styles.wsTimer}>{fmtTime(workoutSession.elapsedSeconds)}</span>
                  <span className={styles.wsXpBadge}>+{workoutSession.xpEarned} XP</span>
                </div>
                <div className={styles.wsProgressOuter}>
                  <div className={styles.wsProgressInner} style={{ width: `${progressPct}%` }} />
                </div>
                <p className={styles.wsCounter}>
                  Exercițiu <strong>{workoutSession.currentIndex + 1}</strong> din <strong>{workoutSession.exercises.length}</strong>
                </p>
                <div className={styles.wsCard}>
                  {ex?.videoUrl && (
                    <div className={`${styles.wsVideoFrame} ${videoReady ? '' : styles.wsVideoFrameLoading}`}>
                      <video
                        key={ex.videoUrl}
                        className={`${styles.wsVideo} ${videoReady ? '' : styles.wsVideoHidden}`}
                        src={ex.videoUrl}
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="auto"
                        onLoadedData={() => {
                          setLoadedWorkoutVideos(prev => prev[ex.videoUrl] ? prev : { ...prev, [ex.videoUrl]: true });
                        }}
                      />
                    </div>
                  )}
                  {exerciseInstructions.length > 0 && (
                    <div className={styles.wsInstructions}>
                      {exerciseInstructions.map((instruction, index) => (
                        <p key={`${instruction}-${index}`}>{instruction}</p>
                      ))}
                    </div>
                  )}
                  <span className={styles.wsMuscle}>{ex?.muscleGroup || ex?.muscle || ''}</span>
                  <h2 className={styles.wsExName}>{ex?.name || ''}</h2>
                  <div className={styles.wsStats}>
                    <div className={styles.wsStat}>
                      <span className={styles.wsStatVal}>{ex?.sets || '—'}</span>
                      <span className={styles.wsStatLbl}>Seturi</span>
                    </div>
                    <div className={styles.wsStatDiv} />
                    <div className={styles.wsStat}>
                      <span className={styles.wsStatVal}>{ex?.reps || '—'}</span>
                      <span className={styles.wsStatLbl}>Repetări</span>
                    </div>
                    <div className={styles.wsStatDiv} />
                    <div className={styles.wsStat}>
                      <span className={styles.wsStatVal}>{ex?.restSeconds ? `${ex.restSeconds}s` : '—'}</span>
                      <span className={styles.wsStatLbl}>Pauză</span>
                    </div>
                  </div>
                  <div style={{ position: 'relative' }}>
                    {xpToast && <span className={styles.wsXpToast}>+{xpToast.amount} XP 🏆</span>}
                    <button className={styles.wsExDoneBtn} onClick={handleExerciseDone}>
                      Am terminat exercițiul ✓
                    </button>
                  </div>
                </div>
                <button className={styles.wsAbandonLink} onClick={handleAbandonWorkout}>
                  Abandonează antrenamentul
                </button>
              </div>
            );
          })()}

          {/* ── Done Screen ───────────────────────────────────────── */}
          {workoutSession?.phase === 'done' && (
            <div className={styles.wsWrap}>
              <div className={styles.wsDoneCard}>
                <div className={styles.wsDoneEmoji}>🔥</div>
                <h2 className={styles.wsDoneTitle}>Antrenament complet!</h2>
                <p className={styles.wsDoneSub}>Ai terminat toate exercițiile. Felicitări!</p>
                <div className={styles.wsDoneMeta}>
                  <div className={styles.wsDoneMetaItem}>
                    <span className={styles.wsDoneMetaVal}>{workoutSession.exerciseCount}</span>
                    <span className={styles.wsDoneMetaLbl}>Exerciții</span>
                  </div>
                  <div className={styles.wsDoneMetaDivider} />
                  <div className={styles.wsDoneMetaItem}>
                    <span className={styles.wsDoneMetaVal}>{fmtTime(workoutSession.elapsedSeconds)}</span>
                    <span className={styles.wsDoneMetaLbl}>Timp</span>
                  </div>
                  <div className={styles.wsDoneMetaDivider} />
                  <div className={styles.wsDoneMetaItem}>
                    <span className={styles.wsDoneMetaVal}>+{workoutSession.totalXp}</span>
                    <span className={styles.wsDoneMetaLbl}>XP câștigat</span>
                  </div>
                </div>
                <button className={styles.wsFinishBtn} onClick={handleFinalizeWorkout}>
                  Finalizare antrenament →
                </button>
              </div>
            </div>
          )}

          {/* ── Regular Content (hidden when workout session active) ── */}
          {!workoutSession && !workoutStartScreen && (
          profileOpen ? (
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
          ) : activeTab === 'home' ? (
            renderJourneyDashboard()
          ) : (
          <>
          {/* Tab navigation */}
          {!progressFormOpen && activeTab !== 'plan' && !(!loading && !mealPlan && !error && confirmedNoMealPlan && activeTab === 'plan') && !(!loading && !workoutPlan && confirmedNoWorkoutPlan && activeTab === 'workout') && (
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
                {hasWorkoutInProgress && <span className={styles.planTabPing} aria-hidden="true" />}
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
                  onFinishMeals={(dayIndex) => {
                    const previousLevelInfo = userLevel;
                    fireConfetti();
                    const optimisticLevel = previousLevelInfo ? getLevelInfoFromXp((Number(previousLevelInfo.totalXp) || 0) + 50) : null;
                    setFinishReward({ type: 'meals', dayIndex, levelInfo: optimisticLevel });
                    handleFinishDay('meals', dayIndex, previousLevelInfo).then((data) => {
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
                  onBack={() => handleTabChange('home')}
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
            <>
              {/* Workout Session Start Card */}
              <div style={{ marginBottom: 16 }}>
                <button
                  style={{
                    background: hasActivePausedSession ? '#0a0a0a' : '#0a0a0a',
                    color: '#b7ff00',
                    border: 'none',
                    borderRadius: 14,
                    padding: '14px 24px',
                    fontSize: 15,
                    fontWeight: 800,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    letterSpacing: '-0.3px',
                    transition: 'opacity 0.15s ease, transform 0.12s ease',
                    width: '100%',
                    maxWidth: 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                  onClick={handleStartWorkoutSession}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = ''; }}
                >
                  <WorkoutButtonIcon />
                  {hasActivePausedSession ? 'Continuă antrenamentul' : 'Începe Antrenament'}
                </button>
              </div>
              {workoutPlan ? (
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
            ) : null}
          </>
          )}
          </>
          )
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

      {confirmAbandonWorkout && (
        <div className={clientStyles.modalOverlay} onClick={() => setConfirmAbandonWorkout(false)}>
          <div className={clientStyles.confirmModal} onClick={e => e.stopPropagation()}>
            <div className={styles.abandonConfirmIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h3>Abandonezi antrenamentul?</h3>
            <p>Progresul acestei sesiuni va fi șters și te întorci pe dashboard.</p>
            <div className={clientStyles.confirmActions}>
              <button className={clientStyles.cancelBtn} onClick={() => setConfirmAbandonWorkout(false)}>
                Anulează
              </button>
              <button className={styles.abandonConfirmBtn} onClick={confirmAbandonCurrentWorkout}>
                Da, abandonează
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
            <div className={styles.rewardXpBadge}>
              +50 XP{finishReward.levelInfo?.coinsAwarded ? ` · +${finishReward.levelInfo.coinsAwarded} monede` : ''}
            </div>
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
            <div className={styles.rewardXpBadge}>
              LEVEL UP{levelUpReward.levelInfo?.coinsAwarded ? ` · +${levelUpReward.levelInfo.coinsAwarded} monede` : ''}
            </div>
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

    {/* ── XP Finish Popup (after workout finalize) ─────────────── */}
    {xpFinishPopup && (
      <div className={styles.xpPopupOverlay} onClick={() => {
        setXpFinishPopup(null);
        if (pendingLevelUp) {
          setLevelUpReward(pendingLevelUp);
          setPendingLevelUp(null);
          fireConfetti();
        }
      }}>
        <div className={styles.xpPopupCard} onClick={e => e.stopPropagation()}>
          <div className={styles.xpPopupEmoji}>🔥</div>
          <div className={styles.xpPopupBadge}>+{xpFinishPopup.totalXp + 50} XP</div>
          <h3 className={styles.xpPopupTitle}>Antrenament finalizat!</h3>
          <p className={styles.xpPopupSub}>
            Ai terminat {xpFinishPopup.exerciseCount} exerciții în {fmtTime(xpFinishPopup.elapsedSeconds)}. Bravo!
          </p>
          <div className={styles.xpPopupMeta}>
            <div className={styles.xpPopupMetaItem}>
              <span className={styles.xpPopupMetaVal}>{xpFinishPopup.exerciseCount}</span>
              <span className={styles.xpPopupMetaLbl}>Exerciții</span>
            </div>
            <div className={styles.xpPopupMetaDivider} />
            <div className={styles.xpPopupMetaItem}>
              <span className={styles.xpPopupMetaVal}>{fmtTime(xpFinishPopup.elapsedSeconds)}</span>
              <span className={styles.xpPopupMetaLbl}>Timp</span>
            </div>
            <div className={styles.xpPopupMetaDivider} />
            <div className={styles.xpPopupMetaItem}>
              <span className={styles.xpPopupMetaVal}>+{xpFinishPopup.totalXp + 50}</span>
              <span className={styles.xpPopupMetaLbl}>XP total</span>
            </div>
          </div>
          {userLevel && (
            <div className={styles.rewardLevelLine}>
              Nivel {userLevel.level}
              <span>{userLevel.xpInCurrentLevel} / {userLevel.xpForNextLevel} XP</span>
            </div>
          )}
          <button className={styles.xpPopupBtn} onClick={() => {
            setXpFinishPopup(null);
            if (pendingLevelUp) {
              setLevelUpReward(pendingLevelUp);
              setPendingLevelUp(null);
              fireConfetti();
            }
          }}>
            Super, merg mai departe
          </button>
        </div>
      </div>
    )}
    </>
  );
}

export default function ClientDashboard() {
  return (
    <ProtectedRoute requiredRole={['client', 'user']}>
      <ClientDashboardContent />
    </ProtectedRoute>
  );
}
