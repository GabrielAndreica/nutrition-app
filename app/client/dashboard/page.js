'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
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
  loading: () => <PlanModuleSkeleton compact />
});

const WorkoutPlan = dynamic(() => import('@/app/components/WorkoutPlanGenerator/WorkoutPlan'), {
  ssr: false,
  loading: () => <PlanModuleSkeleton compact />
});

const fireSmallConfetti = async () => {
  const confetti = (await import('canvas-confetti')).default;
  confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 }, colors: ['#b7ff00', '#0a0a0a', '#ffffff'], zIndex: 9999 });
};

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const WATER_XP_REWARD = 20;

const RECIPE_MEAL_TYPE_LABELS = {
  breakfast: 'Mic dejun',
  lunch: 'Prânz',
  dinner: 'Cină',
  snack: 'Gustare',
};
const SHOW_RECIPE_SHOP = false;
const SHOW_APP_COINS = false;
const EMPTY_WEEKLY_CHECKIN_FORM = {
  weightKg: '',
  mealAdherencePct: null,
  workoutAdherencePct: null,
  workoutDifficulty: null,
  hungerLevel: null,
};

function PlanModuleSkeleton({ compact = false }) {
  return (
    <div className={`${styles.moduleSkeleton} ${compact ? styles.moduleSkeletonCompact : ''}`}>
      <div className={styles.moduleSkeletonTop}>
        <div className={`${styles.shimmer} ${styles.moduleSkeletonBack}`} />
        <div className={`${styles.shimmer} ${styles.moduleSkeletonPill}`} />
      </div>
      <div className={styles.moduleSkeletonHeader}>
        <div>
          <div className={`${styles.shimmer} ${styles.moduleSkeletonTitle}`} />
          <div className={`${styles.shimmer} ${styles.moduleSkeletonSubtitle}`} />
        </div>
        <div className={`${styles.shimmer} ${styles.moduleSkeletonBadge}`} />
      </div>
      <div className={styles.moduleSkeletonDays}>
        {[1, 2, 3, 4, 5, 6, 7].map(i => (
          <div key={i} className={`${styles.shimmer} ${styles.moduleSkeletonDay}`} />
        ))}
      </div>
      <div className={styles.moduleSkeletonCards}>
        {[1, 2, 3].map(i => (
          <div key={i} className={styles.moduleSkeletonCard}>
            <div className={`${styles.shimmer} ${styles.moduleSkeletonImage}`} />
            <div className={styles.moduleSkeletonBody}>
              <div className={`${styles.shimmer} ${styles.moduleSkeletonLineLg}`} />
              <div className={`${styles.shimmer} ${styles.moduleSkeletonLineSm}`} />
              <div className={`${styles.shimmer} ${styles.moduleSkeletonButton}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardLoadingSkeleton() {
  return (
    <div className={styles.dashboardSkeleton}>
      <div className={styles.dashboardSkeletonHero}>
        <div>
          <div className={`${styles.shimmer} ${styles.dashboardSkeletonGreeting}`} />
          <div className={`${styles.shimmer} ${styles.dashboardSkeletonSub}`} />
        </div>
        <div className={`${styles.shimmer} ${styles.dashboardSkeletonStreak}`} />
      </div>

      <div className={styles.dashboardSkeletonProgress}>
        <div className={`${styles.shimmer} ${styles.dashboardSkeletonCircle}`} />
        <div className={styles.dashboardSkeletonProgressText}>
          <div className={`${styles.shimmer} ${styles.dashboardSkeletonLineLg}`} />
          <div className={`${styles.shimmer} ${styles.dashboardSkeletonLineSm}`} />
        </div>
      </div>

      <div className={styles.dashboardSkeletonMissions}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className={styles.dashboardSkeletonMission}>
            <div className={`${styles.shimmer} ${styles.dashboardSkeletonDot}`} />
            <div className={`${styles.shimmer} ${styles.dashboardSkeletonMissionLine}`} />
          </div>
        ))}
      </div>

      <div className={styles.dashboardSkeletonCards}>
        {[1, 2].map(i => (
          <div key={i} className={styles.dashboardSkeletonActionCard}>
            <div className={`${styles.shimmer} ${styles.dashboardSkeletonLineLg}`} />
            <div className={`${styles.shimmer} ${styles.dashboardSkeletonLineSm}`} />
            <div className={`${styles.shimmer} ${styles.dashboardSkeletonAction}`} />
          </div>
        ))}
      </div>

      <div className={`${styles.shimmer} ${styles.dashboardSkeletonWater}`} />
    </div>
  );
}

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

function formatLiters(valueMl) {
  return (Number(valueMl) / 1000).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
}

function parseDecimalInput(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!normalized) return NaN;
  return Number(normalized);
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function formatKg(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : '-';
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
  rest: {
    title: 'Rest Day',
    description: 'Zi de recuperare: păstrează mișcarea ușoară, hidratarea bună și somnul serios. Pauza face parte din progres.',
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

function RewardLevelProgress({ levelInfo }) {
  if (!levelInfo) return null;

  const progressPct = Math.max(0, Math.min(100, Number(levelInfo.progressPct) || 0));

  return (
    <div className={styles.rewardLevelLine}>
      <div className={styles.rewardLevelMeta}>
        <strong>Nivel {levelInfo.level}</strong>
        <span>{levelInfo.xpInCurrentLevel} / {levelInfo.xpForNextLevel} XP</span>
      </div>
      <div className={styles.rewardLevelTrack} aria-hidden="true">
        <div className={styles.rewardLevelFill} style={{ width: `${progressPct}%` }} />
      </div>
    </div>
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
  const [waterRewardClaimed, setWaterRewardClaimed] = useState(false);
  const [waterRewardSaving, setWaterRewardSaving] = useState(false);
  const [dayFinalized, setDayFinalized] = useState(false);
  const [streakCount, setStreakCount] = useState(0);
  const [streakState, setStreakState] = useState('normal');
  const [weeklyPlanRegenerating, setWeeklyPlanRegenerating] = useState(false);
  const [weeklyRegenProgress, setWeeklyRegenProgress] = useState(6);
  const [weeklyRegenStep, setWeeklyRegenStep] = useState(0);
  const [weeklyRegenMessage, setWeeklyRegenMessage] = useState('Pregătim planurile noi...');
  const [weeklyCheckInDue, setWeeklyCheckInDue] = useState(false);
  const [weeklyCheckInStatus, setWeeklyCheckInStatus] = useState(null);
  const [weeklyCheckInForm, setWeeklyCheckInForm] = useState(() => ({ ...EMPTY_WEEKLY_CHECKIN_FORM }));
  const [weeklyCheckInSubmitting, setWeeklyCheckInSubmitting] = useState(false);
  const [weeklyCheckInError, setWeeklyCheckInError] = useState('');
  const [weeklyCheckInResult, setWeeklyCheckInResult] = useState(null);
  const [confirmWeeklyCheckIn, setConfirmWeeklyCheckIn] = useState(false);
  const [progressFormOpen, setProgressFormOpen] = useState(false);
  const [allNotifications, setAllNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [visibleNotifications, setVisibleNotifications] = useState(5);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [sentFriendRequests, setSentFriendRequests] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  const [friendsError, setFriendsError] = useState('');
  const [friendsSetupRequired, setFriendsSetupRequired] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState([]);
  const [friendSearchLoading, setFriendSearchLoading] = useState(false);
  const [friendInviteMessage, setFriendInviteMessage] = useState('');
  const [friendInviteLoadingId, setFriendInviteLoadingId] = useState(null);
  const [friendActionLoadingId, setFriendActionLoadingId] = useState(null);
  const [friendRemoveLoadingId, setFriendRemoveLoadingId] = useState(null);
  const [friendRemoveConfirm, setFriendRemoveConfirm] = useState(null);
  const [visibleFriendsCount, setVisibleFriendsCount] = useState(10);
  const notificationsPanelRef = useRef(null);
  const mainScrollRef = useRef(null);
  const fetchedRef = useRef(false);
  const enrichedMealPlanLoadedRef = useRef(false);
  const preloadedTodayMealImageRef = useRef('');
  const waterRewardAttemptedRef = useRef(false);
  const weeklyCheckInWasDueRef = useRef(false);
  const checkoutReturnHandledRef = useRef(false);
  const startWeeklyPlanRegenerationRef = useRef(null);

  // ── Workout Session SPA ──────────────────────────────────────────────────
  // null | {phase:'loading'} | {phase:'active', focus, exercises, currentIndex, xpEarned, elapsedSeconds, startedAt}
  // | {phase:'done', focus, totalXp, elapsedSeconds, exerciseCount}
  const [workoutSession, setWorkoutSession] = useState(null);
  // null | { exercises, focus } — shown before timer starts (pre-flight)
  const [workoutStartScreen, setWorkoutStartScreen] = useState(null);
  const [workoutTodayPreview, setWorkoutTodayPreview] = useState(null);
  // true when a paused session exists in DB (shows "Continuă" button)
  const [hasActivePausedSession, setHasActivePausedSession] = useState(false);
  const [confirmAbandonWorkout, setConfirmAbandonWorkout] = useState(false);
  const [xpToast, setXpToast] = useState(null);       // { amount } | null
  const [xpFinishPopup, setXpFinishPopup] = useState(null); // { totalXp, elapsedSeconds, exerciseCount } | null
  const [loadedWorkoutVideos, setLoadedWorkoutVideos] = useState({});
  const markWorkoutVideoLoaded = useCallback((url) => {
    if (!url) return;
    setLoadedWorkoutVideos(prev => prev[url] ? prev : { ...prev, [url]: true });
  }, []);
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
  const [shopRecipes, setShopRecipes] = useState([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopError, setShopError] = useState('');
  const [shopAppCoins, setShopAppCoins] = useState(0);
  const [purchasingRecipeId, setPurchasingRecipeId] = useState(null);

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
      targetWeight: c.target_weight ? String(c.target_weight) : undefined,
      height: c.height ? String(c.height) : undefined,
      gender: c.gender,
      goal: c.goal,
      activityLevel: c.activity_level,
      dietType: c.diet_type,
      allergies: c.allergies,
      mealsPerDay: c.meals_per_day ? String(c.meals_per_day) : undefined,
      workoutsPerWeek: c.workouts_per_week ? Number(c.workouts_per_week) : undefined,
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

  const loadWeeklyCheckInStatus = async (token) => {
    if (!token) return null;
    try {
      const response = await fetch('/api/user/weekly-checkin', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut citi check-in-ul.');
      setWeeklyCheckInStatus(data);
      setWeeklyCheckInDue(!!data.due);
      return data;
    } catch (err) {
      console.error('Weekly check-in status failed:', err);
      return null;
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const payment = params.get('payment');
    const sessionId = params.get('session_id');

    if (tab === 'progress' || payment === 'success') {
      setActiveTab('progress');
      setSidebarOpen(false);
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        document.querySelector(`.${styles.main}`)?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
      });
    }

    if (payment !== 'success' || !sessionId?.startsWith('cs_') || checkoutReturnHandledRef.current) return;
    checkoutReturnHandledRef.current = true;

    const token = localStorage.getItem('token');
    if (!token) return;

    (async () => {
      try {
        const response = await fetch('/api/stripe/sync-checkout-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sessionId }),
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          const updated = { ...(user || {}), ...data };
          localStorage.setItem('user', JSON.stringify(updated));
          login(updated, token);

          const weeklyResponse = await fetch('/api/user/weekly-checkin', {
            headers: { Authorization: `Bearer ${token}` },
          });
          const weeklyData = await weeklyResponse.json().catch(() => ({}));
          if (weeklyResponse.ok) {
            setWeeklyCheckInStatus(weeklyData);
            setWeeklyCheckInDue(!!weeklyData.due);
          }

          try {
            const previousLevelInfo = userLevel;
            const xpResponse = await fetch('/api/user/xp', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ type: 'subscription_upgrade', amount: 50 }),
            });
            const xpData = await xpResponse.json().catch(() => ({}));
            if (xpResponse.ok) {
              setUserLevel(xpData);
              const levelUp = getLevelUpPayload(previousLevelInfo, xpData, xpData.xpAdded || 50);
              if (levelUp) setPendingLevelUp(levelUp);
              setFinishReward({
                type: 'subscription_upgrade',
                levelInfo: xpData,
                xpAdded: xpData.xpAdded || 50,
              });
              setTimeout(() => {
                fireConfetti();
              }, 120);
            }
          } catch (error) {
            console.error('Coach upgrade XP reward failed:', error);
          }
        }
      } catch (error) {
        console.error('Checkout sync after redirect failed:', error);
      } finally {
        window.history.replaceState(null, '', '/client/dashboard?tab=progress');
      }
    })();
  }, [login, user, userLevel]);

  const refreshWorkoutTodayPreview = async (token) => {
    if (!token) return null;
    try {
      const response = await fetch('/api/user/workout-session?focus=auto&preview=1', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      setWorkoutTodayPreview(data);
      return data;
    } catch {
      return null;
    }
  };

  const fetchShopRecipes = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    setShopLoading(true);
    setShopError('');
    try {
      const response = await fetch('/api/user/recipes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut încărca magazinul.');

      setShopRecipes((data.recipes || []).filter(recipe => recipe.unlocked !== true));
      setShopAppCoins(Math.max(0, Number(data.appCoins) || 0));
      setUserLevel(prev => prev ? { ...prev, appCoins: data.appCoins } : prev);
    } catch (err) {
      setShopError(err.message || 'Nu am putut încărca magazinul.');
    } finally {
      setShopLoading(false);
    }
  }, []);

  const fetchFriends = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    setFriendsLoading(true);
    setFriendsError('');
    try {
      const response = await fetch('/api/user/friends', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut încărca prietenii.');

      setFriends(Array.isArray(data.friends) ? data.friends : []);
      setFriendRequests(Array.isArray(data.incomingRequests) ? data.incomingRequests : []);
      setSentFriendRequests(Array.isArray(data.outgoingRequests) ? data.outgoingRequests : []);
      setFriendsLoaded(true);
      setFriendsSetupRequired(data.setupRequired === true);
    } catch (err) {
      setFriendsError(err.message || 'Nu am putut încărca prietenii.');
    } finally {
      setFriendsLoading(false);
    }
  }, []);

  const searchFriends = useCallback(async (query) => {
    const token = localStorage.getItem('token');
    const cleanQuery = String(query || '').trim();
    if (!token || cleanQuery.length < 2) {
      setFriendSearchResults([]);
      return;
    }

    setFriendSearchLoading(true);
    setFriendInviteMessage('');
    try {
      const response = await fetch(`/api/user/friends?q=${encodeURIComponent(cleanQuery)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut căuta utilizatori.');
      setFriendSearchResults(Array.isArray(data.users) ? data.users : []);
      setFriendsSetupRequired(data.setupRequired === true);
    } catch (err) {
      setFriendsError(err.message || 'Nu am putut căuta utilizatori.');
      setFriendSearchResults([]);
    } finally {
      setFriendSearchLoading(false);
    }
  }, []);

  const inviteFriend = async (friendUserId) => {
    const token = localStorage.getItem('token');
    if (!token || friendInviteLoadingId) return;

    setFriendInviteLoadingId(friendUserId);
    setFriendsError('');
    setFriendInviteMessage('');
    try {
      const response = await fetch('/api/user/friends', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ friendUserId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut trimite invitația.');

      setFriendInviteMessage(data.message || 'Invitație trimisă.');
      setFriendSearchResults(prev => prev.map(item => (
        Number(item.userId) === Number(friendUserId)
          ? { ...item, relationStatus: 'pending_outgoing', friendshipId: data.friendshipId || item.friendshipId || null }
          : item
      )));
      if (data.status === 'accepted') {
        fetchFriends();
        fetchNotifications();
      } else {
        fetchFriends();
      }
    } catch (err) {
      setFriendsError(err.message || 'Nu am putut trimite invitația.');
    } finally {
      setFriendInviteLoadingId(null);
    }
  };

  const respondToFriendRequest = async (friendshipId, action) => {
    const token = localStorage.getItem('token');
    if (!token || friendActionLoadingId) return;

    setFriendActionLoadingId(`${friendshipId}:${action}`);
    setFriendsError('');
    setFriendInviteMessage('');
    try {
      const response = await fetch('/api/user/friends', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ friendshipId, action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut actualiza cererea.');

      setFriendInviteMessage(data.message || (action === 'accept' ? 'Cerere acceptată.' : 'Cerere respinsă.'));
      setFriendSearchResults(prev => prev.map(item => (
        String(item.friendshipId || '') === String(friendshipId)
          ? {
              ...item,
              relationStatus: action === 'accept' ? 'accepted' : 'none',
              friendshipId: action === 'accept' ? item.friendshipId : null,
            }
          : item
      )));
      await Promise.all([fetchFriends(), fetchNotifications()]);
    } catch (err) {
      setFriendsError(err.message || 'Nu am putut actualiza cererea.');
    } finally {
      setFriendActionLoadingId(null);
    }
  };

  const removeFriend = async (friendshipId) => {
    const token = localStorage.getItem('token');
    if (!token || friendRemoveLoadingId) return;

    setFriendRemoveLoadingId(friendshipId);
    setFriendsError('');
    setFriendInviteMessage('');
    try {
      const response = await fetch('/api/user/friends', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ friendshipId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut elimina prietenul.');

      setFriendInviteMessage(data.message || 'Prieten eliminat.');
      setFriendSearchResults(prev => prev.map(item => (
        String(item.friendshipId || '') === String(friendshipId)
          ? { ...item, relationStatus: 'none', friendshipId: null }
          : item
      )));
      await fetchFriends();
    } catch (err) {
      setFriendsError(err.message || 'Nu am putut elimina prietenul.');
    } finally {
      setFriendRemoveLoadingId(null);
      setFriendRemoveConfirm(null);
    }
  };

  const handlePurchaseRecipe = async (recipeId) => {
    const token = localStorage.getItem('token');
    if (!token || purchasingRecipeId) return;

    setPurchasingRecipeId(recipeId);
    setShopError('');
    try {
      const response = await fetch(`/api/user/recipes/${recipeId}/purchase`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut cumpăra rețeta.');

      setShopRecipes(prev => prev.filter(recipe => String(recipe.id) !== String(recipeId)));
      setShopAppCoins(Math.max(0, Number(data.appCoins) || 0));
      setUserLevel(prev => prev ? { ...prev, appCoins: data.appCoins } : prev);
    } catch (err) {
      setShopError(err.message || 'Nu am putut cumpăra rețeta.');
    } finally {
      setPurchasingRecipeId(null);
    }
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
    if (activeTab !== 'shop') return;
    fetchShopRecipes();
  }, [activeTab, fetchShopRecipes]);

  useEffect(() => {
    if (activeTab !== 'friends') return;
    fetchFriends();
  }, [activeTab, fetchFriends]);

  useEffect(() => {
    if (activeTab === 'friends') setVisibleFriendsCount(10);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'friends' || visibleFriendsCount >= friends.length) return undefined;

    const handleFriendsScroll = () => {
      const scroller = mainScrollRef.current;
      if (!scroller) return;
      const nearBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 360;
      if (nearBottom) {
        setVisibleFriendsCount(count => Math.min(count + 10, friends.length));
      }
    };

    const scroller = mainScrollRef.current;
    if (!scroller) return undefined;
    scroller.addEventListener('scroll', handleFriendsScroll, { passive: true });
    handleFriendsScroll();
    return () => scroller.removeEventListener('scroll', handleFriendsScroll);
  }, [activeTab, friends.length, visibleFriendsCount]);

  useEffect(() => {
    if (activeTab !== 'friends') return undefined;
    const cleanQuery = friendSearch.trim();
    if (cleanQuery.length < 2) {
      setFriendSearchResults([]);
      setFriendSearchLoading(false);
      return undefined;
    }

    const timer = setTimeout(() => searchFriends(cleanQuery), 260);
    return () => clearTimeout(timer);
  }, [activeTab, friendSearch, searchFriends]);

  useEffect(() => {
    if (weeklyCheckInDue && !weeklyCheckInWasDueRef.current) {
      setWeeklyCheckInForm({ ...EMPTY_WEEKLY_CHECKIN_FORM });
      setWeeklyCheckInError('');
      setWeeklyCheckInResult(null);
      setConfirmWeeklyCheckIn(false);
    }
    weeklyCheckInWasDueRef.current = weeklyCheckInDue;
  }, [weeklyCheckInDue]);

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
    } else if (notif.type === 'friend_request' || notif.type === 'friend_request_accepted') {
      await fetchFriends();
      setActiveTab('friends');
    }
  };

  // Marchează toate ca citite
  const markAllAsRead = useCallback(async () => {
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
  }, []);

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
          targetWeight: c.target_weight ? String(c.target_weight) : undefined,
          height: c.height ? String(c.height) : undefined,
          gender: c.gender,
          goal: c.goal,
          activityLevel: c.activity_level,
          dietType: c.diet_type,
          allergies: c.allergies,
          mealsPerDay: c.meals_per_day ? String(c.meals_per_day) : undefined,
          workoutsPerWeek: c.workouts_per_week ? Number(c.workouts_per_week) : undefined,
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
      .then(data => { setHasActivePausedSession(!!data?.activeSession); })
      .catch(() => {});

    refreshWorkoutTodayPreview(tok2);

    // Verifică reward pending de la onboarding
    try {
      const raw = localStorage.getItem('pendingOnboardingReward');
      if (raw) {
        localStorage.removeItem('pendingOnboardingReward');
        const reward = JSON.parse(raw);
        setTimeout(() => {
          if (reward.type === 'levelUp') {
            setLevelUpReward({ fromLevel: reward.fromLevel, toLevel: reward.toLevel, levelInfo: reward.levelInfo });
          } else {
            setFinishReward({ type: 'onboarding', levelInfo: reward.levelInfo });
          }
          setTimeout(() => {
            fireConfetti();
          }, 120);
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
          targetWeight: c.target_weight ? String(c.target_weight) : undefined,
          height: c.height ? String(c.height) : undefined,
          gender: c.gender,
          goal: c.goal,
          activityLevel: c.activity_level,
          dietType: c.diet_type,
          allergies: c.allergies,
          mealsPerDay: c.meals_per_day ? String(c.meals_per_day) : undefined,
          workoutsPerWeek: c.workouts_per_week ? Number(c.workouts_per_week) : undefined,
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
          setWeeklyCheckInDue(true);
        }
        setWeeklyPlanRegenerating(!!data?.weeklyPlanRegenerating);
        loadWeeklyCheckInStatus(token);
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

  useEffect(() => {
    if (!notificationsOpen || !allNotifications.some(n => n.unread)) return;
    markAllAsRead();
  }, [allNotifications, markAllAsRead, notificationsOpen]);

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
    const previousMealsCooldownUntil = mealsCooldownUntil;
    const previousWorkoutCooldownUntil = workoutCooldownUntil;
    const previousMealsCompletedDays = mealsCompletedDays;
    const previousWorkoutCompletedDays = workoutCompletedDays;
    const previousMealDayStatus = mealDayStatus;
    const previousWorkoutDayStatus = workoutDayStatus;
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
    if (type === 'day') {
      setDayFinalized(true);
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
      if (type === 'day') setDayFinalized(data.dayFinalized === true);
      return data;
    } catch (err) {
      if (optimisticLevel) setUserLevel(previousLevelInfo);
      if (type === 'meals') {
        setMealsCooldownUntil(previousMealsCooldownUntil);
        setMealsCompletedDays(previousMealsCompletedDays);
        setMealDayStatus(previousMealDayStatus || {});
      }
      if (type === 'workout') {
        setWorkoutCooldownUntil(previousWorkoutCooldownUntil);
        setWorkoutCompletedDays(previousWorkoutCompletedDays);
        setWorkoutDayStatus(previousWorkoutDayStatus || {});
      }
      if (type === 'day') setDayFinalized(false);
      setError(err.message || 'Nu am putut finaliza ziua.');
      return null;
    }
  };

  const firstName = user?.name?.split(' ')[0] || user?.name || '';
  const todayKey = String(currentPlanDay);
  const mealsDoneToday = mealDayStatus?.[todayKey] === true;
  const isWorkoutRestDayToday = !hasActivePausedSession && workoutTodayPreview?.isRestDay === true;
  const workoutDoneToday = workoutDayStatus?.[todayKey] === true;
  const hydrationTargetMl = Number(clientData?.hydrationTargetMl) || null;
  const hydrationTargetLoaded = Number.isFinite(hydrationTargetMl) && hydrationTargetMl > 0;
  const hydrationTargetLiters = hydrationTargetLoaded ? formatLiters(hydrationTargetMl) : null;
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
  const activeWorkoutPreloadVideoUrls = workoutSession?.phase === 'active'
    ? [...new Set((workoutSession.exercises || [])
      .slice(Math.max(0, (workoutSession.currentIndex || 0) + 1))
      .map(ex => ex.videoUrl)
      .filter(Boolean)
      .filter(url => !loadedWorkoutVideos[url]))]
    : [];
  const waterDoneToday = hydrationTargetLoaded && waterLoaded && waterMl >= hydrationTargetMl;
  const hasWorkoutInProgress = hasActivePausedSession || workoutSession?.phase === 'active';
  const dayDoneToday = dayFinalized === true;
  const canFinalizeDay = workoutDoneToday && mealsDoneToday && waterDoneToday && !dayDoneToday;
  const weeklyDoneCount =
    Object.values(mealDayStatus || {}).filter(Boolean).length +
    Object.values(workoutDayStatus || {}).filter(Boolean).length;
  const weeklyCompletionPct = Math.min(100, Math.round((weeklyDoneCount / 14) * 100));
  const dailyMissions = [
    {
      key: 'workout',
      label: isWorkoutRestDayToday ? 'Bifează recuperarea zilei' : 'Finalizează antrenamentul de azi',
      done: workoutDoneToday,
    },
    {
      key: 'meals',
      label: 'Respectă mesele zilei',
      done: mealsDoneToday,
    },
    {
      key: 'water',
      label: hydrationTargetLoaded ? `Bea ${hydrationTargetLiters} L apă` : 'Bea apa zilei',
      done: waterDoneToday,
    },
    {
      key: 'day',
      label: 'Finalizează ziua',
      done: dayDoneToday,
    },
  ];
  const dailyMissionDoneCount = dailyMissions.filter(mission => mission.done).length;
  const dailyMissionTotal = dailyMissions.length;
  const dailyProgressPct = Math.round((dailyMissionDoneCount / dailyMissionTotal) * 100);
  const dailyProgressMessage = dailyMissionDoneCount === dailyMissionTotal
    ? 'Zi completă. Continuă tot așa mâine!'
    : dailyMissionDoneCount === dailyMissionTotal - 1
      ? 'Mai ai un pas pentru ziua de azi.'
      : `Mai ai ${dailyMissionTotal - dailyMissionDoneCount} pași pentru ziua de azi.`;
  const workoutMetaText = isWorkoutRestDayToday
    ? 'Zi de recuperare. Bifeaz-o când ai respectat pauza.'
    : 'Deschide sesiunea pregătită pentru azi.';
  const waterProgressPct = hydrationTargetLoaded && waterLoaded
    ? Math.min(100, Math.round((waterMl / hydrationTargetMl) * 100))
    : 0;
  const waterProgressText = hydrationTargetLoaded && waterLoaded
    ? `${formatLiters(waterMl)} / ${formatLiters(hydrationTargetMl)} L`
    : 'Se încarcă progresul de apă';
  const finishRewardTitle = finishReward
    ? (finishReward.type === 'onboarding'
      ? 'Înregistrare finalizată!'
      : finishReward.type === 'subscription_upgrade'
      ? 'Coach activat!'
      : finishReward.type === 'meals'
      ? 'Mese finalizate'
      : finishReward.type === 'day'
      ? 'Zi finalizată'
      : finishReward.type === 'water'
      ? 'Hidratare completă'
      : finishReward.type === 'checkin'
      ? 'Check-in trimis'
      : finishReward.isRecovery
      ? 'Recuperare bifată'
      : 'Antrenament finalizat')
    : '';
  const finishRewardMessage = finishReward
    ? (finishReward.type === 'onboarding'
      ? 'Bine ai venit! Ai câștigat primii 50 XP pentru că ți-ai completat profilul.'
      : finishReward.type === 'subscription_upgrade'
      ? 'Abonamentul Trevano Coach este activ. Ai primit +50 XP pentru upgrade.'
      : finishReward.type === 'meals'
      ? 'Bravo, ai închis ziua alimentar cum trebuie. +50 XP pentru consecvență.'
      : finishReward.type === 'day'
      ? 'Ai închis toate misiunile zilei. +50 XP pentru consecvență.'
      : finishReward.type === 'water'
      ? 'Ai atins targetul de apă al zilei. +20 XP pentru consecvență.'
      : finishReward.type === 'checkin'
      ? 'Progresul tău a fost salvat. +50 XP pentru că ți-ai făcut check-in-ul.'
      : finishReward.isRecovery
      ? 'Foarte bine. Recuperarea contează la fel de mult ca efortul. +50 XP adăugați.'
      : 'Excelent. Ai dus antrenamentul până la capăt și ai câștigat +50 XP.')
    : '';

  const claimWaterReward = useCallback(async () => {
    if (waterRewardSaving || waterRewardClaimed) return;

    waterRewardAttemptedRef.current = true;
    setWaterRewardSaving(true);

    const previousLevelInfo = userLevel;
    const optimisticLevel = previousLevelInfo
      ? getLevelInfoFromXp((Number(previousLevelInfo.totalXp) || 0) + WATER_XP_REWARD)
      : null;

    if (optimisticLevel) setUserLevel(optimisticLevel);

    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Token lipsă.');

      const response = await fetch('/api/user/xp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: WATER_XP_REWARD, type: 'water' }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 409 && /deja acordat/i.test(String(data.error || ''))) {
          setWaterRewardClaimed(true);
        }
        if (optimisticLevel) setUserLevel(previousLevelInfo);
        return;
      }

      setWaterRewardClaimed(true);
      if (data.level) {
        setUserLevel(data);
        const levelUp = getLevelUpPayload(previousLevelInfo, data, data.xpAdded || WATER_XP_REWARD);
        if (levelUp) setPendingLevelUp(levelUp);
      }
      setFinishReward({
        type: 'water',
        levelInfo: data.level ? data : (optimisticLevel || previousLevelInfo),
        xpAdded: data.xpAdded || WATER_XP_REWARD,
      });
      fireSmallConfetti();
    } catch (err) {
      console.error('Water XP reward failed:', err);
      if (optimisticLevel) setUserLevel(previousLevelInfo);
    } finally {
      setWaterRewardSaving(false);
    }
  }, [userLevel, waterRewardClaimed, waterRewardSaving]);

  useEffect(() => {
    let cancelled = false;

    async function loadDailyWater() {
      setWaterLoaded(false);
      waterRewardAttemptedRef.current = false;
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('Token lipsă.');

        const response = await fetch(`/api/user/daily-progress?planDay=${encodeURIComponent(currentPlanDay)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Nu am putut citi apa de azi.');

        if (!cancelled) {
          setWaterMl(Math.max(0, Number(data.waterMl) || 0));
          setWaterRewardClaimed(data.waterGoalAwarded === true);
          setDayFinalized(data.dayFinalized === true);
        }
      } catch (err) {
        console.error('Daily water sync load failed:', err);
        if (!cancelled) {
          setWaterMl(0);
          setWaterRewardClaimed(false);
          setDayFinalized(false);
        }
      } finally {
        if (!cancelled) setWaterLoaded(true);
      }
    }

    loadDailyWater();
    return () => { cancelled = true; };
  }, [currentPlanDay, user?.id]);

  useEffect(() => {
    if (
      !hydrationTargetLoaded ||
      !waterLoaded ||
      dayFinalized ||
      waterRewardClaimed ||
      waterRewardSaving ||
      waterRewardAttemptedRef.current
    ) {
      return;
    }

    if (waterMl >= hydrationTargetMl) {
      claimWaterReward();
    }
  }, [
    claimWaterReward,
    dayFinalized,
    hydrationTargetLoaded,
    hydrationTargetMl,
    waterLoaded,
    waterMl,
    waterRewardClaimed,
    waterRewardSaving,
  ]);

  const closeFinishReward = () => {
    setFinishReward(null);
    if (pendingLevelUp) {
      setLevelUpReward(pendingLevelUp);
      setPendingLevelUp(null);
      fireConfetti();
    }
  };

  const handleLogout = () => { logout(); router.push('/'); };
  const handleTabChange = (tab) => {
    setError(null);
    setActiveTab(tab);
    setSidebarOpen(false);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.querySelector(`.${styles.main}`)?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
    });
  };
  const handleAddWater = async () => {
    if (!hydrationTargetLoaded || !waterLoaded || waterSaving || waterDoneToday || dayFinalized) return;

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
        body: JSON.stringify({ waterMl: next, planDay: currentPlanDay }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut salva apa de azi.');
      setWaterMl(Math.max(0, Number(data.waterMl) || next));
      if (data.waterGoalAwarded === true) setWaterRewardClaimed(true);
    } catch (err) {
      console.error('Daily water sync save failed:', err);
      setWaterMl(previous);
    } finally {
      setWaterSaving(false);
    }
  };

  const handleWeeklyCheckInChange = (field, value) => {
    setWeeklyCheckInForm(prev => ({ ...prev, [field]: value }));
    setWeeklyCheckInError('');
  };

  const getWeeklyCheckInCompletionState = () => {
    const weeklyWeight = parseDecimalInput(weeklyCheckInForm.weightKg);
    return Number.isFinite(weeklyWeight)
      && weeklyWeight >= 30
      && weeklyWeight <= 300
      && weeklyCheckInForm.mealAdherencePct !== null
      && weeklyCheckInForm.mealAdherencePct !== undefined
      && weeklyCheckInForm.workoutAdherencePct !== null
      && weeklyCheckInForm.workoutAdherencePct !== undefined
      && weeklyCheckInForm.workoutDifficulty !== null
      && weeklyCheckInForm.workoutDifficulty !== undefined
      && weeklyCheckInForm.hungerLevel !== null
      && weeklyCheckInForm.hungerLevel !== undefined;
  };

  const openWeeklyCheckInConfirm = (event) => {
    event.preventDefault();
    setWeeklyCheckInError('');
    if (weeklyCheckInSubmitting) return;
    if (!getWeeklyCheckInCompletionState()) {
      setWeeklyCheckInError('Completează toate câmpurile înainte să trimiți progresul.');
      return;
    }
    setConfirmWeeklyCheckIn(true);
  };

  const submitWeeklyCheckInConfirmed = async () => {
    if (weeklyCheckInSubmitting) return;

    setWeeklyCheckInSubmitting(true);
    setWeeklyCheckInError('');
    setWeeklyCheckInResult(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Token lipsă.');
      const previousLevelInfo = userLevel;
      const weightKg = parseDecimalInput(weeklyCheckInForm.weightKg);

      const response = await fetch('/api/user/weekly-checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          weightKg,
          mealAdherencePct: weeklyCheckInForm.mealAdherencePct,
          workoutAdherencePct: weeklyCheckInForm.workoutAdherencePct,
          workoutDifficulty: weeklyCheckInForm.workoutDifficulty,
          hungerLevel: weeklyCheckInForm.hungerLevel,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nu am putut salva check-in-ul.');

      setWeeklyCheckInResult(data);
      setWeeklyCheckInDue(false);
      setConfirmWeeklyCheckIn(false);
      setWeeklyCheckInForm({ ...EMPTY_WEEKLY_CHECKIN_FORM });
      setActiveTab('progress');
      setWeeklyCheckInStatus(prev => ({ ...(prev || {}), due: false, latestCheckIn: data }));
      if (data.targetsAfter) setNutritionalNeeds(data.targetsAfter);

      const xpResponse = await fetch('/api/user/xp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: 50, type: 'progress_update' }),
      });
      const xpData = await xpResponse.json().catch(() => ({}));

      if (data.planAdjusted) {
        const snapshot = await fetchUserPlansSnapshot(token);
        applyUserPlansSnapshot(snapshot);
      } else {
        setClientData(prev => prev ? { ...prev, weight: String(weightKg || prev.weight) } : prev);
      }

      if (xpResponse.ok && xpData?.level) {
        setUserLevel(xpData);
        const levelUp = getLevelUpPayload(previousLevelInfo, xpData, xpData.xpAdded || 50);
        if (levelUp) setPendingLevelUp(levelUp);
        window.setTimeout(() => {
          setFinishReward({ type: 'checkin', levelInfo: xpData, xpAdded: xpData.xpAdded || 50 });
          fireConfetti();
        }, 220);
      }
    } catch (err) {
      setWeeklyCheckInError(err.message || 'Check-in-ul nu a putut fi salvat.');
    } finally {
      setWeeklyCheckInSubmitting(false);
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

  const renderRecipeShop = () => (
    <div className={styles.shopPage}>
      <div className={styles.shopHeader}>
        <button className={styles.shopBackBtn} onClick={() => handleTabChange('home')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Înapoi
        </button>
        <div className={styles.shopTitleRow}>
          <div>
            <h1 className={styles.shopTitle}>Magazin</h1>
            <p className={styles.shopSubtitle}>Deblochează mese noi pentru planurile tale viitoare.</p>
          </div>
          <div className={styles.shopWallet}>
            <CoinAmount amount={userLevel?.appCoins ?? shopAppCoins} />
          </div>
        </div>
      </div>

      {shopError && (
        <div className={styles.shopError}>{shopError}</div>
      )}

      {shopLoading ? (
        <div className={styles.shopState}>Se încarcă rețetele...</div>
      ) : shopRecipes.length === 0 ? (
        <div className={styles.shopState}>Ai deblocat toate rețetele disponibile momentan.</div>
      ) : (
        <div className={styles.shopGrid}>
          {shopRecipes.map(recipe => {
            const canAfford = (Number(userLevel?.appCoins ?? shopAppCoins) || 0) >= Number(recipe.coinPrice || 0);
            const isPurchasing = purchasingRecipeId === recipe.id;
            return (
              <article key={recipe.id} className={styles.shopRecipeCard}>
                {recipe.imageUrl ? (
                  <div className={styles.shopRecipeImageWrap}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className={styles.shopRecipeImage}
                      src={recipe.imageUrl}
                      alt={recipe.name}
                      loading="lazy"
                      decoding="async"
                      onError={(event) => {
                        if (recipe.imageFallbackUrl && event.currentTarget.src !== recipe.imageFallbackUrl) {
                          event.currentTarget.src = recipe.imageFallbackUrl;
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div className={styles.shopRecipeImageEmpty}>
                    <span>{RECIPE_MEAL_TYPE_LABELS[recipe.mealType] || 'Masă'}</span>
                  </div>
                )}
                <div className={styles.shopRecipeBody}>
                  <span className={styles.shopRecipeType}>{RECIPE_MEAL_TYPE_LABELS[recipe.mealType] || recipe.mealType}</span>
                  <h2 className={styles.shopRecipeName}>{recipe.name}</h2>
                  {recipe.proteinSource && (
                    <p className={styles.shopRecipeMeta}>{recipe.proteinSource}</p>
                  )}
                  <button
                    className={styles.shopBuyBtn}
                    onClick={() => handlePurchaseRecipe(recipe.id)}
                    disabled={!canAfford || isPurchasing}
                    title={!canAfford ? 'Nu ai suficiente monede.' : undefined}
                  >
                    {isPurchasing ? 'Se cumpără...' : (
                      <>
                        Deblochează
                        <CoinAmount amount={recipe.coinPrice || 0} compact />
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );

  const getProgressCheckIn = () => weeklyCheckInResult || weeklyCheckInStatus?.latestCheckIn || null;

  const renderProgressPage = () => {
    const latest = getProgressCheckIn();
    const evaluation = latest?.evaluation || {};
    const outcome = latest?.outcome || evaluation.outcome || '';
    const goal = latest?.goal || evaluation.goal || weeklyCheckInStatus?.goal || clientData?.goal || '';
    const weightKg = latest?.weightKg || latest?.weight_kg || weeklyCheckInStatus?.latestCheckIn?.weightKg || null;
    const previousWeightKg = latest?.previousWeightKg || latest?.previous_weight_kg || null;
    const weightDeltaKg = Number.isFinite(Number(latest?.weightDeltaKg))
      ? Number(latest.weightDeltaKg)
      : Number.isFinite(Number(evaluation.deltaKg))
        ? Number(evaluation.deltaKg)
        : (Number.isFinite(Number(weightKg)) && Number.isFinite(Number(previousWeightKg))
          ? Math.round((Number(weightKg) - Number(previousWeightKg)) * 10) / 10
          : 0);
    const planAdjusted = latest?.planAdjusted === true || latest?.plan_adjusted === true;
    const recommendation = latest?.recommendation || 'După următorul check-in, aici vei vedea recomandarea personalizată a programului.';
    const accountType = weeklyCheckInStatus?.accountType || latest?.accountType || 'free';
    const metadata = latest?.metadata || {};
    const coachInsights = Array.isArray(latest?.coachInsights)
      ? latest.coachInsights
      : (Array.isArray(metadata.coachInsights) ? metadata.coachInsights : []);
    const nutritionAdjustment = latest?.nutritionAdjustment || metadata.nutritionAdjustment || latest?.adjustment || null;
    const appliedCaloriesAdjustment = Math.round(Number(nutritionAdjustment?.appliedCalories) || 0);
    const waterStats = latest?.waterStats || metadata.waterStats || null;
    const mealAdherencePct = clampNumber(latest?.mealAdherencePct ?? latest?.meal_adherence_pct, 0, 100);
    const workoutAdherencePct = clampNumber(latest?.workoutAdherencePct ?? latest?.workout_adherence_pct, 0, 100);
    const expectedWorkouts = clampNumber(clientData?.workoutsPerWeek || workoutClientData?.workouts_per_week || 3, 1, 5);
    const completedWorkouts = Math.min(expectedWorkouts, Math.round((workoutAdherencePct / 100) * expectedWorkouts));
    const outcomeScore = {
      on_track: 100,
      stable: 78,
      stalled: 64,
      off_track: 48,
    }[outcome] || 72;
    const progressScore = Math.round(clampNumber(
      mealAdherencePct * 0.34 + workoutAdherencePct * 0.34 + outcomeScore * 0.32,
      0,
      100
    ));
    const scoreLabel = progressScore >= 85
      ? 'Foarte bun'
      : progressScore >= 70
        ? 'Bun'
        : 'Există loc de îmbunătățiri';
    const scoreIsStrong = progressScore >= 70;
    const isPositiveInsight = (status) => ['balanced', 'nutrition_on_track'].includes(status);
    const weightChangeText = Math.abs(weightDeltaKg) < 0.1
      ? 'Greutatea a rămas stabilă.'
      : weightDeltaKg < 0
        ? `Ai slăbit ${Math.abs(weightDeltaKg).toFixed(1)} kg.`
        : `Ai crescut ${Math.abs(weightDeltaKg).toFixed(1)} kg.`;
    const goalLabel = {
      weight_loss: 'Slăbire',
      muscle_gain: 'Masă musculară',
      maintenance: 'Menținere',
    }[goal] || 'Obiectiv personal';
    return (
      <div className={styles.progressPage}>
        <div className={styles.progressHeader}>
          <button className={styles.shopBackBtn} onClick={() => handleTabChange('home')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Înapoi
          </button>
          <div>
            <h1 className={styles.progressTitle}>Progres</h1>
            <p className={styles.progressSubtitle}>Recomandările tale după check-in-urile săptămânale.</p>
          </div>
        </div>

        {!latest ? (
          <div className={styles.progressEmptyState}>
            <div className={styles.friendsEmptyIcon}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <h2>Încă nu ai recomandări</h2>
            <p>Completează primul check-in săptămânal, iar aici vei vedea ce îți recomandă programul pentru următoarea săptămână.</p>
          </div>
        ) : (
          <div className={styles.progressStack}>
            {accountType === 'free' ? (
              <>
                <section className={styles.weeklyReportCard}>
                  <div className={styles.weeklyReportHead}>
                    <h2 className={styles.weeklyReportTitle}>Raport săptămânal</h2>
                    <div className={styles.weeklyReportScoreLabel}>Scor de progres</div>
                    <strong>{progressScore}/100</strong>
                    <p className={scoreIsStrong ? styles.weeklyReportStatusGood : styles.weeklyReportStatusWarning}>
                      <span aria-hidden="true">{scoreIsStrong ? '✓' : '!'}</span> {scoreLabel}
                    </p>
                  </div>

                  <div className={styles.weeklyReportList}>
                    <div className={styles.weeklyReportRow}>
                      <span>Greutate</span>
                      <strong>{formatKg(previousWeightKg)} → {formatKg(weightKg)} kg</strong>
                    </div>
                    <p className={styles.weeklyReportNote}>{weightChangeText}</p>

                    <div className={styles.weeklyReportRow}>
                      <span>Antrenamente</span>
                      <strong>{completedWorkouts}/{expectedWorkouts}</strong>
                    </div>

                    <div className={styles.weeklyReportRow}>
                      <span>Mese respectate</span>
                      <strong>{mealAdherencePct}%</strong>
                    </div>

                    <div className={styles.weeklyReportRow}>
                      <span>Streak</span>
                      <strong>{streakCount} zile</strong>
                    </div>
                  </div>
                </section>

                <section className={styles.progressPaywallCard}>
                  <div>
                    <h2>Trevano Coach</h2>
                    <strong>29,99 lei/lună</strong>
                    <p>Trevano îți urmărește progresul și îți spune exact ce trebuie schimbat pentru a ajunge la obiectiv.</p>
                  </div>
                  <button type="button" onClick={() => router.push('/upgrade')}>
                    Activează Coach
                  </button>
                </section>
              </>
            ) : (
              <>
                <section className={styles.weeklyReportCard}>
                  <div className={styles.weeklyReportHead}>
                    <h2 className={styles.weeklyReportTitle}>Raport săptămânal</h2>
                    <div className={styles.weeklyReportScoreLabel}>Scor de progres</div>
                    <strong>{progressScore}/100</strong>
                    <p className={scoreIsStrong ? styles.weeklyReportStatusGood : styles.weeklyReportStatusWarning}>
                      <span aria-hidden="true">{scoreIsStrong ? '✓' : '!'}</span> {scoreLabel}
                    </p>
                  </div>

                  <div className={styles.weeklyReportList}>
                    <div className={styles.weeklyReportRow}>
                      <span>Greutate</span>
                      <strong>{formatKg(previousWeightKg)} → {formatKg(weightKg)} kg</strong>
                    </div>
                    <p className={styles.weeklyReportNote}>{weightChangeText}</p>

                    <div className={styles.weeklyReportRow}>
                      <span>Obiectiv</span>
                      <strong>{goalLabel}</strong>
                    </div>

                    <div className={styles.weeklyReportRow}>
                      <span>Antrenamente</span>
                      <strong>{completedWorkouts}/{expectedWorkouts}</strong>
                    </div>

                    <div className={styles.weeklyReportRow}>
                      <span>Mese respectate</span>
                      <strong>{mealAdherencePct}%</strong>
                    </div>

                    <div className={styles.weeklyReportRow}>
                      <span>Streak</span>
                      <strong>{streakCount} zile</strong>
                    </div>

                    <div className={styles.weeklyReportRow}>
                      <span>Apă săptămânal</span>
                      <strong>{waterStats?.targetMl ? `${waterStats.completionPct}%` : '-'}</strong>
                    </div>

                    {appliedCaloriesAdjustment !== 0 && (
                      <div className={styles.weeklyReportRow}>
                        <span>Calorii ajustate</span>
                        <strong>{`${appliedCaloriesAdjustment > 0 ? '+' : ''}${appliedCaloriesAdjustment} kcal`}</strong>
                      </div>
                    )}

                    <p className={styles.weeklyReportNote}>{recommendation}</p>
                  </div>

                  {coachInsights.length > 0 && (
                    <div className={styles.coachInsightsBlock}>
                      <div className={styles.coachInsightsHeader}>
                        <h2>Detalii despre program</h2>
                        <p>Ce merită ajustat pentru săptămâna următoare.</p>
                      </div>
                      <div className={styles.coachInsightList}>
                        {coachInsights.map((insight, index) => (
                          <article key={`${insight.status || 'insight'}-${index}`} className={styles.coachInsightItem}>
                            <span
                              className={isPositiveInsight(insight.status)
                                ? styles.coachInsightIconGood
                                : styles.coachInsightIconWarning}
                              aria-hidden="true"
                            >
                              {isPositiveInsight(insight.status) ? '✓' : '!'}
                            </span>
                            <div>
                              <h3>{insight.title}</h3>
                              <p>{insight.message}</p>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  )}

                  {planAdjusted && (
                    <div className={styles.progressAdjustmentNote}>
                      Planul alimentar a fost ajustat automat pentru următoarea săptămână.
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const getFriendSearchActionLabel = (result) => {
    if (result.relationStatus === 'accepted') return 'Prieten';
    if (result.relationStatus === 'pending_outgoing') return 'Trimis';
    if (result.relationStatus === 'pending_incoming') return 'Cerere primită';
    return 'Invită';
  };

  const getFriendNotificationState = (friendshipId) => {
    const id = String(friendshipId || '');
    if (!id) return 'none';
    if (friendRequests.some(request => String(request.id) === id)) return 'pending';
    if (friends.some(friend => String(friend.id) === id)) return 'accepted';
    if (!friendsLoaded) return 'pending';
    return 'resolved';
  };

  const renderFriendsPage = () => (
    <div className={styles.friendsPage}>
      <div className={styles.friendsHeader}>
        <button className={styles.shopBackBtn} onClick={() => handleTabChange('home')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Înapoi
        </button>
        <div className={styles.friendsTitleRow}>
          <div>
            <h1 className={styles.friendsTitle}>Prieteni</h1>
            <p className={styles.friendsSubtitle}>Oamenii alături de care îți ții ritmul.</p>
          </div>
        </div>
      </div>

      {friendsError && (
        <div className={styles.shopError}>{friendsError}</div>
      )}

      {!friendsLoading && friendRequests.length > 0 && (
        <section className={styles.friendRequestsPanel}>
          <h2>Cereri de prietenie</h2>
          <div className={styles.friendRequestsList}>
            {friendRequests.map(request => (
              <article key={request.id} className={styles.friendRequestCard}>
                <div className={styles.friendAvatar}>{request.initials}</div>
                <div className={styles.friendInfo}>
                  <h2>{request.name}</h2>
                  <p>Level {request.level} · {request.totalXp} XP</p>
                </div>
                <div className={styles.friendRequestActions}>
                  <button
                    className={styles.friendAcceptBtn}
                    onClick={() => respondToFriendRequest(request.id, 'accept')}
                    disabled={friendActionLoadingId !== null}
                  >
                    {friendActionLoadingId === `${request.id}:accept` ? '...' : 'Accept'}
                  </button>
                  <button
                    className={styles.friendRejectBtn}
                    onClick={() => respondToFriendRequest(request.id, 'reject')}
                    disabled={friendActionLoadingId !== null}
                  >
                    {friendActionLoadingId === `${request.id}:reject` ? '...' : 'Respinge'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className={styles.friendSearchPanel}>
        <label className={styles.friendSearchLabel} htmlFor="friend-search">Caută persoane</label>
        <div className={styles.friendSearchBox}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            id="friend-search"
            type="search"
            value={friendSearch}
            onChange={(event) => {
              setFriendSearch(event.target.value);
              setFriendInviteMessage('');
              setFriendsError('');
            }}
            placeholder="Scrie numele unui utilizator"
          />
          {friendSearchLoading && <span className={styles.friendSearchLoading}>Caut...</span>}
        </div>

        {friendInviteMessage && (
          <p className={styles.friendInviteMessage}>{friendInviteMessage}</p>
        )}

        {friendSearch.trim().length >= 2 && (
          <div className={styles.friendSearchResults}>
            {friendSearchLoading ? (
              <div className={styles.friendSearchEmpty}>Căutăm în aplicație...</div>
            ) : friendSearchResults.length === 0 ? (
              <div className={styles.friendSearchEmpty}>Nu am găsit utilizatori disponibili.</div>
            ) : (
              friendSearchResults.map(result => (
                <article key={result.userId} className={styles.friendSearchResult}>
                  <div className={styles.friendAvatar}>{result.initials}</div>
                  <div className={styles.friendInfo}>
                    <h2>{result.name}</h2>
                    <p>Level {result.level} · {result.totalXp} XP</p>
                  </div>
                  {result.relationStatus === 'accepted' ? (
                    <button
                      className={styles.friendRemoveBtn}
                      onClick={() => setFriendRemoveConfirm({
                        id: result.friendshipId,
                        name: result.name,
                        action: 'remove',
                      })}
                      disabled={friendRemoveLoadingId === result.friendshipId}
                      aria-label={`Elimină ${result.name} din lista de prieteni`}
                      title="Elimină prieten"
                    >
                      {friendRemoveLoadingId === result.friendshipId ? '...' : '×'}
                    </button>
                  ) : result.relationStatus === 'pending_outgoing' ? (
                    <div className={styles.friendSearchActions}>
                      <div className={styles.friendPendingPill}>Trimis</div>
                      <button
                        className={styles.friendRemoveBtn}
                        onClick={() => setFriendRemoveConfirm({
                          id: result.friendshipId,
                          name: result.name,
                          action: 'cancel',
                        })}
                        disabled={friendRemoveLoadingId === result.friendshipId}
                        aria-label={`Anulează invitația trimisă către ${result.name}`}
                        title="Anulează invitația"
                      >
                        {friendRemoveLoadingId === result.friendshipId ? '...' : '×'}
                      </button>
                    </div>
                  ) : (
                    <button
                      className={`${styles.friendInviteBtn} ${result.relationStatus !== 'none' ? styles.friendInviteBtnSent : ''}`}
                      onClick={() => inviteFriend(result.userId)}
                      disabled={friendInviteLoadingId === result.userId || result.relationStatus !== 'none'}
                    >
                      {friendInviteLoadingId === result.userId ? '...' : getFriendSearchActionLabel(result)}
                    </button>
                  )}
                </article>
              ))
            )}
          </div>
        )}
      </section>

      {friendsLoading ? (
        <div className={styles.friendsList}>
          {[1, 2, 3].map(item => (
            <div key={item} className={styles.friendSkeletonCard}>
              <div className={`${styles.shimmer} ${styles.friendSkeletonAvatar}`} />
              <div className={styles.friendSkeletonBody}>
                <div className={`${styles.shimmer} ${styles.friendSkeletonName}`} />
                <div className={`${styles.shimmer} ${styles.friendSkeletonMeta}`} />
              </div>
              <div className={`${styles.shimmer} ${styles.friendSkeletonPill}`} />
            </div>
          ))}
        </div>
      ) : friends.length === 0 && friendRequests.length === 0 && sentFriendRequests.length === 0 ? (
        <div className={styles.friendsEmptyState}>
          <div className={styles.friendsEmptyIcon}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <h2>Nu ai prieteni încă</h2>
          <p>
            {friendsSetupRequired
              ? 'Rulează scriptul pentru modulul de prieteni ca să activezi lista.'
              : 'Când vei adăuga prieteni, îi vei vedea aici.'}
          </p>
        </div>
      ) : (
        <>
          {sentFriendRequests.length > 0 && (
            <section className={styles.sentFriendRequestsPanel}>
              <h2>Invitații trimise</h2>
              <div className={styles.friendsList}>
                {sentFriendRequests.map(request => (
                  <article key={request.id} className={styles.friendCard}>
                    <div className={styles.friendAvatar}>{request.initials}</div>
                    <div className={styles.friendInfo}>
                      <h2>{request.name}</h2>
                      <p>Level {request.level} · {request.totalXp} XP</p>
                    </div>
                    <div className={styles.friendCardActions}>
                      <div className={styles.friendPendingPill}>În așteptare</div>
                      <button
                        className={styles.friendRemoveBtn}
                        onClick={() => setFriendRemoveConfirm({
                          id: request.id,
                          name: request.name,
                          action: 'cancel',
                        })}
                        disabled={friendRemoveLoadingId === request.id}
                        aria-label={`Anulează invitația trimisă către ${request.name}`}
                        title="Anulează invitația"
                      >
                        {friendRemoveLoadingId === request.id ? '...' : '×'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {friends.length > 0 && (
            <div className={styles.friendsList}>
              {friends.slice(0, visibleFriendsCount).map(friend => (
                <article key={friend.id} className={styles.friendCard}>
                  <div className={styles.friendAvatar}>{friend.initials}</div>
                  <div className={styles.friendInfo}>
                    <h2>{friend.name}</h2>
                    <p>Level {friend.level} · {friend.totalXp} XP</p>
                  </div>
                  <div className={styles.friendCardActions}>
                    <div className={styles.friendStreak}>
                      <span>🔥</span>
                      <strong>{friend.streakCount}</strong>
                    </div>
                    <button
                      className={styles.friendRemoveBtn}
                      onClick={() => setFriendRemoveConfirm({ ...friend, action: 'remove' })}
                      disabled={friendRemoveLoadingId === friend.id}
                      aria-label={`Elimină ${friend.name} din lista de prieteni`}
                      title="Elimină prieten"
                    >
                      {friendRemoveLoadingId === friend.id ? '...' : '×'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  const renderWeeklyCheckInChoices = (field, options) => (
    <div className={styles.weeklyCheckInChoiceGroup}>
      {options.map(option => {
        const fieldValue = weeklyCheckInForm[field];
        const active = fieldValue !== null && fieldValue !== undefined && Number(fieldValue) === Number(option.value);
        return (
          <button
            key={`${field}-${option.label}`}
            type="button"
            className={`${styles.weeklyCheckInChoiceBtn} ${active ? styles.weeklyCheckInChoiceBtnActive : ''}`}
            onClick={() => handleWeeklyCheckInChange(field, option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );

  const renderWeeklyCheckInCard = () => {
    if (!weeklyCheckInDue) return null;
    const weeklyWeight = parseDecimalInput(weeklyCheckInForm.weightKg);
    const weeklyCheckInComplete = Number.isFinite(weeklyWeight)
      && weeklyWeight >= 30
      && weeklyWeight <= 300
      && weeklyCheckInForm.mealAdherencePct !== null
      && weeklyCheckInForm.mealAdherencePct !== undefined
      && weeklyCheckInForm.workoutAdherencePct !== null
      && weeklyCheckInForm.workoutAdherencePct !== undefined
      && weeklyCheckInForm.workoutDifficulty !== null
      && weeklyCheckInForm.workoutDifficulty !== undefined
      && weeklyCheckInForm.hungerLevel !== null
      && weeklyCheckInForm.hungerLevel !== undefined;

    return (
      <section className={styles.weeklyCheckInCard}>
        <div className={styles.weeklyCheckInHead}>
          <div>
            <h2 className={styles.weeklyCheckInTitle}>Cum a decurs săptămâna?</h2>
            <p className={styles.weeklyCheckInSubtitle}>
              Spune-ne greutatea de azi și cum a mers săptămâna. Folosim răspunsurile ca planul tău să rămână potrivit pentru tine.
            </p>
          </div>
        </div>

        <form className={styles.weeklyCheckInForm} onSubmit={openWeeklyCheckInConfirm} autoComplete="off">
          <label className={styles.weeklyCheckInField}>
            <span>Greutatea de azi (kg)</span>
            <input
              type="number"
              min="30"
              max="300"
              step="0.1"
              value={weeklyCheckInForm.weightKg}
              onChange={(event) => handleWeeklyCheckInChange('weightKg', event.target.value)}
              autoComplete="off"
              required
            />
          </label>

          <div className={styles.weeklyCheckInField}>
            <span>Cât te-ai ținut de mese?</span>
            {renderWeeklyCheckInChoices('mealAdherencePct', [
              { label: 'Deloc', value: 0 },
              { label: 'Parțial', value: 50 },
              { label: 'Complet', value: 100 },
            ])}
          </div>

          <div className={styles.weeklyCheckInField}>
            <span>Cât te-ai ținut de antrenamente?</span>
            {renderWeeklyCheckInChoices('workoutAdherencePct', [
              { label: 'Deloc', value: 0 },
              { label: 'Parțial', value: 50 },
              { label: 'Complet', value: 100 },
            ])}
          </div>

          <div className={styles.weeklyCheckInMiniGrid}>
            <div className={styles.weeklyCheckInField}>
              <span>Cât de grele au fost antrenamentele?</span>
              {renderWeeklyCheckInChoices('workoutDifficulty', [
                { label: 'Ușoare', value: 1 },
                { label: 'Normale', value: 3 },
                { label: 'Grele', value: 5 },
              ])}
            </div>

            <div className={styles.weeklyCheckInField}>
              <span>Cât de foame ți-a fost?</span>
              {renderWeeklyCheckInChoices('hungerLevel', [
                { label: 'Foarte', value: 5 },
                { label: 'Normal', value: 3 },
                { label: 'Deloc', value: 1 },
              ])}
            </div>
          </div>

          {weeklyCheckInError && <p className={styles.weeklyCheckInError}>{weeklyCheckInError}</p>}

          <button
            className={styles.weeklyCheckInSubmit}
            type="submit"
            disabled={weeklyCheckInSubmitting || !weeklyCheckInComplete}
          >
            {weeklyCheckInSubmitting ? 'Se salvează...' : 'Trimite progres'}
          </button>
        </form>
      </section>
    );
  };

  const renderJourneyDashboard = () => {
    const showWeeklyCheckInOnly = weeklyCheckInDue;

    return (
      <div className={`${styles.dummyPlanScreen} ${styles.dummyPlanScreenDash}`}>
        {!showWeeklyCheckInOnly && (
          <section className={styles.dashboardTopLine}>
            <h1 className={styles.dashboardGreeting}>Bună, {firstName || 'campion'} <span aria-hidden="true">👋</span></h1>
          </section>
        )}

        {showWeeklyCheckInOnly ? renderWeeklyCheckInCard() : (
          <>
            <section className={`${styles.dailyProgressHero} ${dailyProgressPct === 100 ? styles.dailyProgressHeroDone : ''}`}>
        <div
          className={styles.dailyProgressCircle}
          style={{ '--daily-progress': `${dailyProgressPct}%` }}
          aria-label={`${dailyMissionDoneCount} din ${dailyMissionTotal} misiuni completate`}
        >
          <div className={styles.dailyProgressCircleInner}>
            <strong>{dailyMissionDoneCount} / {dailyMissionTotal}</strong>
            <span>misiuni</span>
          </div>
        </div>
        <p className={styles.dailyProgressMessage}>{dailyProgressMessage}</p>
        <div className={styles.dailyMissionList}>
          {dailyMissions.map(mission => (
            <div key={mission.key} className={`${styles.dailyMissionItem} ${mission.done ? styles.dailyMissionItemDone : ''}`}>
              <span className={styles.dailyMissionCheck}>{mission.done ? '✓' : ''}</span>
              <span>{mission.label}</span>
            </div>
          ))}
          {canFinalizeDay && (
            <button
              type="button"
              className={styles.dailyMissionFinishBtn}
              onClick={() => setConfirmFinish({ type: 'day', dayIndex: currentPlanDay })}
            >
              Finalizează ziua
            </button>
          )}
        </div>
      </section>

      <section className={styles.dashboardActionGrid}>
        <article className={`${styles.dashboardActionCard} ${workoutDoneToday ? styles.dashboardActionCardDone : ''}`}>
          <div className={styles.dashboardActionTop}>
            <div className={styles.dashboardActionIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.5 6.5v11"/>
                <path d="M17.5 6.5v11"/>
                <path d="M3.5 9v6"/>
                <path d="M20.5 9v6"/>
                <path d="M6.5 12h11"/>
              </svg>
            </div>
            <div>
              <h2>{isWorkoutRestDayToday ? 'Recuperare azi' : 'Antrenament azi'}</h2>
              <p>{workoutDoneToday ? 'Completat' : workoutMetaText}</p>
            </div>
          </div>
          {workoutDoneToday ? (
            <button className={`${styles.dashboardActionBtn} ${styles.dashboardActionBtnComplete}`} disabled>
              COMPLET
            </button>
          ) : isWorkoutRestDayToday ? (
            <button
              className={styles.dashboardActionBtn}
              onClick={() => setConfirmFinish({ type: 'workout', dayIndex: currentPlanDay, isRecovery: true })}
            >
              START
            </button>
          ) : (
            <button className={styles.dashboardActionBtn} onClick={openWorkoutPlan}>
              {hasWorkoutInProgress ? 'CONTINUĂ' : 'START'}
            </button>
          )}
        </article>

        <article className={`${styles.dashboardActionCard} ${mealsDoneToday ? styles.dashboardActionCardDone : ''}`}>
          <div className={styles.dashboardActionTop}>
            <div className={styles.dashboardActionIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 2v7a3 3 0 0 0 6 0V2"/>
                <path d="M7 2v20"/>
                <path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3Z"/>
                <path d="M21 15v7"/>
              </svg>
            </div>
            <div>
              <h2>{mealsDoneToday ? 'Plan alimentar' : 'Mese de azi'}</h2>
              <p>{mealsDoneToday ? 'Completat azi' : 'Vezi ce mese ai pregătite pentru azi.'}</p>
            </div>
          </div>
          <button className={styles.dashboardActionBtn} onClick={openMealPlan}>
            VEZI
          </button>
        </article>
      </section>

      <section className={`${styles.dashboardWaterPanel} ${waterDoneToday ? styles.dashboardWaterPanelDone : ''}`}>
        <div className={styles.dashboardWaterHead}>
          <div>
            <h2>Apă</h2>
            <p>{waterProgressText}</p>
          </div>
          <button
            className={styles.dashboardWaterBtn}
            onClick={handleAddWater}
            disabled={!hydrationTargetLoaded || !waterLoaded || waterSaving || waterDoneToday}
          >
            +250ml
          </button>
        </div>
        <div className={styles.dashboardWaterTrack}>
          <div className={styles.dashboardWaterFill} style={{ width: `${waterProgressPct}%` }} />
        </div>
      </section>

      <section className={styles.dashboardActionGrid}>
        <article className={styles.dashboardActionCard}>
          <div className={styles.dashboardActionTop}>
            <div className={styles.dashboardActionIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <div>
              <h2>Progres</h2>
              <p>Vezi raportul și recomandările tale.</p>
            </div>
          </div>
          <button className={styles.dashboardActionBtn} onClick={() => handleTabChange('progress')}>
            VEZI
          </button>
        </article>

        <article className={styles.dashboardActionCard}>
          <div className={styles.dashboardActionTop}>
            <div className={styles.dashboardActionIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div>
              <h2>Prieteni</h2>
              <p>Ține ritmul alături de oamenii tăi.</p>
            </div>
          </div>
          <button className={styles.dashboardActionBtn} onClick={() => handleTabChange('friends')}>
            VEZI
          </button>
        </article>
      </section>
          </>
        )}
      </div>
    );
  };

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
      setWorkoutTodayPreview(focusData);
      // Show pre-flight start screen
      setWorkoutSession(null);
      setWorkoutStartScreen({
        focus: focusData.focus,
        isRestDay: focusData.isRestDay === true,
        message: focusData.message,
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
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState('');

  const isCoachAccount = user?.account_type === 'paid' || user?.subscription_status === 'active';
  const accountTypeLabel = isCoachAccount ? 'Coach' : 'Gratuit';
  const accountTypeDescription = isCoachAccount
    ? 'Abonamentul Trevano Coach este activ pentru acest cont.'
    : 'Folosești planul gratuit. Poți activa Trevano Coach oricând.';

  const refreshAccountStatus = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const updated = { ...user, ...data };
      localStorage.setItem('user', JSON.stringify(updated));
      login(updated, token);
    } catch {
      // Profilul rămâne utilizabil chiar dacă sincronizarea live eșuează.
    }
  };

  const openProfile = () => {
    setProfileForm({ name: user?.name || '', email: user?.email || '', currentPassword: '', newPassword: '' });
    setProfileError('');
    setProfileSuccess('');
    setPasswordResetMessage('');
    setPasswordResetError('');
    setBillingError('');
    setProfileOpen(true);
    setSidebarOpen(false);
    refreshAccountStatus();
  };

  const closeProfile = () => {
    setProfileOpen(false);
    setProfileError('');
    setProfileSuccess('');
    setPasswordResetMessage('');
    setPasswordResetError('');
    setBillingError('');
  };

  const handleBillingAction = async () => {
    setBillingError('');

    if (!isCoachAccount) {
      router.push('/upgrade');
      return;
    }

    setBillingLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/stripe/create-portal-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!res.ok || !data?.url) {
        setBillingError(data.error || 'Nu am putut deschide gestionarea abonamentului.');
        return;
      }

      window.location.href = data.url;
    } catch {
      setBillingError('Eroare de rețea. Încearcă din nou.');
    } finally {
      setBillingLoading(false);
    }
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
          <main className={styles.main} ref={mainScrollRef}>
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
            <DashboardLoadingSkeleton />
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
        {SHOW_APP_COINS && userLevel && (
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

          <div
            className={`${styles.sidebarItem} ${activeTab === 'progress' ? styles.sidebarItemActive : ''}`}
            onClick={() => {
              setNotificationsOpen(false);
              handleTabChange('progress');
            }}
          >
            <div className={styles.sidebarIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </div>
            <span className={styles.sidebarLabel}>Progres</span>
          </div>

          <div
            className={`${styles.sidebarItem} ${activeTab === 'friends' ? styles.sidebarItemActive : ''}`}
            onClick={() => {
              setNotificationsOpen(false);
              handleTabChange('friends');
            }}
          >
            <div className={styles.sidebarIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <span className={styles.sidebarLabel}>Prieteni</span>
          </div>

          {SHOW_RECIPE_SHOP && (
            <div
              className={`${styles.sidebarItem} ${activeTab === 'shop' ? styles.sidebarItemActive : ''}`}
              onClick={() => {
                setNotificationsOpen(false);
                handleTabChange('shop');
              }}
            >
              <div className={styles.sidebarIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                  <path d="M3 6h18" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
              </div>
              <span className={styles.sidebarLabel}>Magazin</span>
            </div>
          )}

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
                    if (notif.type === 'friend_request' || notif.type === 'friend_request_accepted') type = 'friend';
                    const isFriendRequest = notif.type === 'friend_request' && notif.related_client_id;
                    const friendNotificationState = isFriendRequest
                      ? getFriendNotificationState(notif.related_client_id)
                      : 'none';

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
                          ) : type === 'friend' ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                              <circle cx="9" cy="7" r="4"/>
                              <path d="M19 8v6"/>
                              <path d="M22 11h-6"/>
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
                          {isFriendRequest && (
                            <div className={styles.notificationFriendActions} onClick={(event) => event.stopPropagation()}>
                              {friendNotificationState === 'pending' ? (
                                <>
                                  <button
                                    className={styles.notificationFriendAccept}
                                    onClick={() => respondToFriendRequest(notif.related_client_id, 'accept')}
                                    disabled={friendActionLoadingId !== null}
                                  >
                                    {friendActionLoadingId === `${notif.related_client_id}:accept` ? '...' : 'Accept'}
                                  </button>
                                  <button
                                    className={styles.notificationFriendReject}
                                    onClick={() => respondToFriendRequest(notif.related_client_id, 'reject')}
                                    disabled={friendActionLoadingId !== null}
                                  >
                                    {friendActionLoadingId === `${notif.related_client_id}:reject` ? '...' : 'Respinge'}
                                  </button>
                                </>
                              ) : (
                                <button
                                  className={`${styles.notificationFriendAccept} ${styles.notificationFriendResolved}`}
                                  disabled
                                >
                                  {friendNotificationState === 'accepted' ? 'Acceptat' : 'Respins'}
                                </button>
                              )}
                            </div>
                          )}
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
            {SHOW_APP_COINS && userLevel && (
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
        <main className={`${styles.main} ${(!mealPlan && !loading && !error) ? styles.mainNoScroll : ''}`} ref={mainScrollRef}>

          {/* ── Workout Loading ───────────────────────────────────── */}
          {workoutSession?.phase === 'loading' && (
            <div className={styles.wsWrap}>
              <div className={styles.wsLoading}>
                <div className={styles.wsLoadingSkeleton}>
                  <div className={`${styles.shimmer} ${styles.wsLoadingVideo}`} />
                  <div className={styles.wsLoadingLines}>
                    <div className={`${styles.shimmer} ${styles.wsLoadingTitle}`} />
                    <div className={`${styles.shimmer} ${styles.wsLoadingSub}`} />
                    <div className={`${styles.shimmer} ${styles.wsLoadingButton}`} />
                  </div>
                </div>
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
                      onLoadedData={() => markWorkoutVideoLoaded(url)}
                      onCanPlay={() => markWorkoutVideoLoaded(url)}
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
                  {workoutStartScreen.isRestDay
                    ? (workoutStartScreen.message || workoutStartCopy?.description)
                    : workoutStartCopy?.description}
                </p>
                {workoutStartScreen.isRestDay ? (
                  <div className={styles.workoutStartMeta}>
                    <div className={styles.workoutStartMetaItem}>
                      <span className={styles.workoutStartMetaVal}>0</span>
                      <span className={styles.workoutStartMetaLbl}>Exerciții</span>
                    </div>
                    <div className={styles.workoutStartMetaDivider} />
                    <div className={styles.workoutStartMetaItem}>
                      <span className={styles.workoutStartMetaVal}>+50</span>
                      <span className={styles.workoutStartMetaLbl}>XP recuperare</span>
                    </div>
                    <div className={styles.workoutStartMetaDivider} />
                    <div className={styles.workoutStartMetaItem}>
                      <span className={styles.workoutStartMetaVal}>Somn</span>
                      <span className={styles.workoutStartMetaLbl}>Prioritate</span>
                    </div>
                  </div>
                ) : (
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
                )}
                {workoutStartScreen.isRestDay ? (
                  <button
                    className={styles.workoutStartBtn}
                    onClick={() => {
                      setConfirmFinish({
                        type: 'workout',
                        dayIndex: workoutStartScreen.workoutDayIndex ?? currentPlanDay,
                        isRecovery: true,
                      });
                    }}
                  >
                    Bifează recuperarea
                  </button>
                ) : (
                  <button className={styles.workoutStartBtn} onClick={handleStartActualSession}>
                    <WorkoutButtonIcon />
                    Începe antrenament
                  </button>
                )}
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
                {activeWorkoutPreloadVideoUrls.length > 0 && (
                  <div className={styles.workoutVideoPreloadBank} aria-hidden="true">
                    {activeWorkoutPreloadVideoUrls.map(url => (
                      <video
                        key={url}
                        src={url}
                        muted
                        playsInline
                        preload="auto"
                        onLoadedData={() => markWorkoutVideoLoaded(url)}
                        onCanPlay={() => markWorkoutVideoLoaded(url)}
                      />
                    ))}
                  </div>
                )}
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
                        onLoadedData={() => markWorkoutVideoLoaded(ex.videoUrl)}
                        onCanPlay={() => markWorkoutVideoLoaded(ex.videoUrl)}
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
                          value={accountTypeLabel}
                          readOnly
                          className={styles.accountReadonlyInput}
                        />
                      </div>

                      <p className={styles.profileHelpText}>{accountTypeDescription}</p>

                      <button
                        type="button"
                        className={styles.accountFormBtn}
                        onClick={handleBillingAction}
                        disabled={billingLoading}
                      >
                        {billingLoading
                          ? 'Se deschide...'
                          : isCoachAccount
                            ? 'Gestionează abonamentul'
                            : 'Activează Coach'}
                      </button>

                      {billingError && <p className={styles.profileModalError}>{billingError}</p>}
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
          ) : activeTab === 'progress' ? (
            renderProgressPage()
          ) : activeTab === 'friends' ? (
            renderFriendsPage()
          ) : SHOW_RECIPE_SHOP && activeTab === 'shop' ? (
            renderRecipeShop()
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
                  {hasActivePausedSession
                    ? 'Continuă antrenamentul'
                    : isWorkoutRestDayToday
                      ? 'Vezi recuperarea'
                      : 'Începe Antrenament'}
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

      {friendRemoveConfirm && (
        <div
          className={clientStyles.modalOverlay}
          onClick={() => !friendRemoveLoadingId && setFriendRemoveConfirm(null)}
        >
          <div className={clientStyles.confirmModal} onClick={e => e.stopPropagation()}>
            <div className={clientStyles.confirmIcon} style={{ background: 'rgba(10,10,10,0.07)', color: '#0a0a0a' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="18" y1="8" x2="23" y2="13"/>
                <line x1="23" y1="8" x2="18" y2="13"/>
              </svg>
            </div>
            <h3>{friendRemoveConfirm.action === 'cancel' ? 'Anulezi invitația?' : 'Elimini prietenul?'}</h3>
            <p>
              {friendRemoveConfirm.action === 'cancel'
                ? `Anulezi invitația trimisă către ${friendRemoveConfirm.name}?`
                : `Îl elimini pe ${friendRemoveConfirm.name} din lista ta de prieteni? Nu vom trimite notificare.`}
            </p>
            <div className={clientStyles.confirmActions}>
              <button
                className={clientStyles.cancelBtn}
                onClick={() => setFriendRemoveConfirm(null)}
                disabled={friendRemoveLoadingId === friendRemoveConfirm.id}
              >
                Anulează
              </button>
              <button
                className={clientStyles.saveBtn}
                style={{ background: '#0a0a0a', color: '#b7ff00' }}
                onClick={() => removeFriend(friendRemoveConfirm.id)}
                disabled={friendRemoveLoadingId === friendRemoveConfirm.id}
              >
                {friendRemoveLoadingId === friendRemoveConfirm.id
                  ? (friendRemoveConfirm.action === 'cancel' ? 'Se anulează...' : 'Se elimină...')
                  : (friendRemoveConfirm.action === 'cancel' ? 'Anulează invitația' : 'Elimină')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmWeeklyCheckIn && (
        <div className={clientStyles.modalOverlay} onClick={() => !weeklyCheckInSubmitting && setConfirmWeeklyCheckIn(false)}>
          <div className={clientStyles.confirmModal} onClick={e => e.stopPropagation()}>
            <div className={clientStyles.confirmIcon} style={{ background: 'rgba(183,255,0,0.18)', color: '#0a0a0a' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
            </div>
            <h3>Trimiți progresul?</h3>
            <p>Salvăm check-in-ul săptămânal, actualizăm planul dacă e nevoie și primești XP pentru consecvență.</p>
            <div className={clientStyles.confirmActions}>
              <button
                className={clientStyles.cancelBtn}
                onClick={() => setConfirmWeeklyCheckIn(false)}
                disabled={weeklyCheckInSubmitting}
              >
                Anulează
              </button>
              <button
                className={clientStyles.saveBtn}
                style={{ background: '#0a0a0a', color: '#b7ff00' }}
                onClick={submitWeeklyCheckInConfirmed}
                disabled={weeklyCheckInSubmitting}
              >
                {weeklyCheckInSubmitting ? 'Se trimite...' : 'Trimite progres'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmFinish && (
        <div className={clientStyles.modalOverlay} onClick={() => setConfirmFinish(null)}>
          <div className={clientStyles.confirmModal} onClick={e => e.stopPropagation()}>
            <div className={clientStyles.confirmIcon} style={{ background: 'rgba(10,10,10,0.07)', color: '#0a0a0a' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h3>{confirmFinish.type === 'meals' || confirmFinish.type === 'day' || confirmFinish.isRecovery ? 'Finalizare zi' : 'Finalizare antrenament'}</h3>
            <p>{confirmFinish.type === 'meals'
              ? 'Ești sigur că ai terminat de mâncat toate mesele de azi?'
              : confirmFinish.type === 'day'
                ? 'Ai bifat antrenamentul, mesele și apa. Finalizezi ziua și primești XP?'
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
                  if (isRecovery) setWorkoutStartScreen(null);
                  const optimisticLevel = previousLevelInfo ? getLevelInfoFromXp((Number(previousLevelInfo.totalXp) || 0) + 50) : null;
                  if (!isRecovery) {
                    fireConfetti();
                    setFinishReward({ type, dayIndex, isRecovery, levelInfo: optimisticLevel });
                  }
                  handleFinishDay(type, dayIndex, previousLevelInfo).then((data) => {
                    if (!data) {
                      setFinishReward(null);
                      setPendingLevelUp(null);
                      return;
                    }
                    setFinishReward(prev => prev
                      ? { ...prev, levelInfo: data.level ? data : prev.levelInfo }
                      : { type, dayIndex, isRecovery, levelInfo: data.level ? data : optimisticLevel });
                    if (isRecovery) fireConfetti();
                    const token = localStorage.getItem('token');
                    if (token && type === 'workout') refreshWorkoutTodayPreview(token);
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
              <span>{finishReward.type === 'onboarding' ? '🎉' : finishReward.type === 'subscription_upgrade' ? '⚡' : finishReward.type === 'meals' ? '💪' : finishReward.type === 'water' ? '💧' : finishReward.type === 'checkin' ? '✓' : '🔥'}</span>
            </div>
            <div className={styles.rewardXpBadge}>+{finishReward.xpAdded || 50} XP</div>
            <h3>{finishRewardTitle}</h3>
            <p>{finishRewardMessage}</p>
            <RewardLevelProgress levelInfo={finishReward.levelInfo || userLevel} />
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
            <RewardLevelProgress levelInfo={levelUpReward.levelInfo} />
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
          <RewardLevelProgress levelInfo={userLevel} />
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
