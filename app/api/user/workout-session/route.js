import { NextResponse } from 'next/server';
import { getSupabase, supabaseQuery } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import {
  buildDailyProgressUpdate,
  reconcileDailyPlanProgress,
} from '@/app/lib/dailyPlanProgress';

// Romanian labels for muscle_group DB values
const MUSCLE_GROUP_RO = {
  chest:        'Piept',
  back:         'Spate',
  shoulders:    'Umeri',
  triceps:      'Triceps',
  biceps:       'Biceps',
  arms:         'Brațe',
  rear_delts:   'Umeri posteriori',
  lats:         'Dorsali',
  traps:        'Trapeze',
  legs:         'Picioare',
  quads:        'Cvadriceps',
  hamstrings:   'Femurali',
  glutes:       'Fesieri',
  calves:       'Gambe',
  core:         'Core',
  abs:          'Abdomen',
  forearms:     'Antebrațe',
  neck:         'Gât',
};

const MUSCLE_GROUP_ALIASES = {
  piept: 'chest',
  pectorali: 'chest',
  spate: 'back',
  dorsali: 'lats',
  trapeze: 'traps',
  umeri: 'shoulders',
  deltoizi: 'shoulders',
  brate: 'arms',
  brațe: 'arms',
  quadriceps: 'quads',
  quad: 'quads',
  cvadriceps: 'quads',
  cvatriceps: 'quads',
  femurali: 'hamstrings',
  biceps_femural: 'hamstrings',
  biceps_femorali: 'hamstrings',
  biceps_femural_din_culcat: 'hamstrings',
  hamstring: 'hamstrings',
  fesieri: 'glutes',
  glutei: 'glutes',
  glute: 'glutes',
  calf: 'calves',
  gambe: 'calves',
  gamba: 'calves',
  abdomen: 'core',
  abs: 'core',
  abdominali: 'core',
  abdomene: 'core',
};

function normalizeTextKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ăâ]/gi, 'a')
    .replace(/[î]/gi, 'i')
    .replace(/[șş]/gi, 's')
    .replace(/[țţ]/gi, 't')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeMuscleGroup(group) {
  const key = normalizeTextKey(group);
  return MUSCLE_GROUP_ALIASES[key] || key || 'other';
}

function muscleRo(group) {
  if (!group) return '';
  const canonical = normalizeMuscleGroup(group);
  return MUSCLE_GROUP_RO[canonical] || MUSCLE_GROUP_RO[String(group).toLowerCase()] || group;
}

// Equipment pools per profile.
const EQUIPMENT_FILTER = {
  'no equipment':   ['bodyweight', 'band', 'bands', 'resistance_band', 'resistance band', 'resistance bands', 'elastic_band', 'elastic band', 'benzi', 'banda elastica', 'dumbbell', 'dumbbells', 'dumbbells only', 'dumbbells_only', 'gantera', 'gantere'],
  'dumbbells only': ['dumbbell', 'bodyweight'],
  'full gym':       null,
};

// Equipment types excluded for full-gym clients when the user explicitly trains in a gym.
const BAND_EQUIPMENT = ['band', 'resistance_band', 'resistance band', 'elastic_band'];
const HOME_EQUIPMENT = ['bodyweight', 'no equipment', 'no_equipment', 'none', 'home'];
const FULL_GYM_EXCLUDED_EQUIPMENT = [...BAND_EQUIPMENT, ...HOME_EQUIPMENT];

function normalizeAvailableEquipment(value) {
  const key = String(value || '').trim().toLowerCase();
  if (['gym', 'sala', 'sală', 'full_gym', 'full-gym', 'full gym'].includes(key)) return 'full gym';
  if (['home', 'acasa', 'acasă', 'no equipment', 'no_equipment', 'bodyweight'].includes(key)) return 'no equipment';
  if (['dumbbells', 'dumbbell', 'dumbbells only', 'dumbbells_only'].includes(key)) return 'dumbbells only';
  return value || 'full gym';
}

function normalizeGender(value) {
  const key = String(value || '').trim().toLowerCase();
  if (['f', 'female', 'feminin', 'woman', 'femeie'].includes(key)) return 'female';
  if (['m', 'male', 'masculin', 'man', 'barbat', 'bărbat'].includes(key)) return 'male';
  return 'unknown';
}

function getExerciseProfile(profile = {}) {
  const age = Number(profile.age);
  const weight = Number(profile.weight);
  const fitnessLevel = String(profile.fitnessLevel || 'beginner').toLowerCase();
  const availableEquipment = normalizeAvailableEquipment(profile.availableEquipment);
  const gender = normalizeGender(profile.gender);
  const isHome = availableEquipment === 'no equipment';
  const isBeginner = fitnessLevel === 'beginner';
  const needsLowImpact =
    isHome &&
    isBeginner &&
    (
      (Number.isFinite(age) && age >= 50) ||
      (gender === 'female' && Number.isFinite(weight) && weight >= 70) ||
      (gender !== 'female' && Number.isFinite(weight) && weight >= 110)
    );

  return {
    age: Number.isFinite(age) ? age : null,
    weight: Number.isFinite(weight) ? weight : null,
    gender,
    fitnessLevel,
    availableEquipment,
    isHome,
    isBeginner,
    needsLowImpact,
  };
}

const LOWER_BODY_GROUP_VALUES = [
  'legs', 'picioare',
  'quads', 'quad', 'quadriceps', 'cvadriceps',
  'hamstrings', 'hamstring', 'femurali', 'biceps_femural', 'biceps femural',
  'glutes', 'glute', 'fesieri', 'glutei',
  'calves', 'calf', 'gambe', 'gamba',
  'core', 'abs', 'abdomen',
];

// Muscle groups targeted per focus
const FOCUS_GROUPS = {
  push:      ['chest', 'shoulders', 'triceps', 'arms', 'core'],
  pull:      ['back', 'lats', 'traps', 'biceps', 'rear_delts', 'arms'],
  legs:      LOWER_BODY_GROUP_VALUES,
  upper:     ['chest', 'back', 'lats', 'traps', 'shoulders', 'triceps', 'biceps', 'rear_delts', 'arms', 'core', 'abs', 'abdomen'],
  lower:     LOWER_BODY_GROUP_VALUES,
  fullBody:  null,
  chest:     ['chest'],
  back:      ['back', 'lats', 'traps'],
  shoulders: ['shoulders'],
  arms:      ['arms', 'biceps', 'triceps'],
  core:      ['core', 'abs', 'abdomen'],
};

const FOCUS_ALLOWED_SLOTS = {
  push: ['chest', 'shoulders', 'triceps', 'core'],
  pull: ['back', 'biceps', 'rear_delts'],
  upper: ['chest', 'back', 'shoulders', 'triceps', 'biceps', 'rear_delts', 'core'],
  lower: ['quads', 'posterior', 'calves', 'core'],
  legs: ['quads', 'posterior', 'calves', 'core'],
  chest: ['chest'],
  back: ['back'],
  shoulders: ['shoulders'],
  arms: ['biceps', 'triceps'],
  core: ['core'],
};

const FOCUS_ALIASES = {
  auto: 'auto',
  rest: 'rest',
  push: 'push',
  pull: 'pull',
  legs: 'legs',
  picioare: 'legs',
  lower: 'lower',
  lower_body: 'lower',
  upper: 'upper',
  upper_body: 'upper',
  fullbody: 'fullBody',
  full_body: 'fullBody',
  total_body: 'fullBody',
  chest: 'chest',
  piept: 'chest',
  back: 'back',
  spate: 'back',
  shoulders: 'shoulders',
  umeri: 'shoulders',
  arms: 'arms',
  brate: 'arms',
  core: 'core',
  abs: 'core',
  abdomen: 'core',
};

function normalizeWorkoutFocus(value) {
  const key = normalizeTextKey(value);
  if (!key) return 'auto';
  return FOCUS_ALIASES[key] || null;
}

// Base exercise counts before frequency scaling.
const FOCUS_COUNTS_BASE = {
  push: 6, pull: 6, legs: 7, upper: 7, lower: 6,
  fullBody: 6, chest: 7, back: 7, shoulders: 6, arms: 6, core: 5,
};

const FOCUS_REQUIRED_SLOTS = {
  fullBody: ['chest', 'back', 'shoulders', 'arms', 'quads', 'posterior', 'core'],
  push: ['chest', 'shoulders', 'triceps', 'core'],
  pull: ['back', 'biceps', 'rear_delts'],
  upper: ['chest', 'back', 'shoulders', 'triceps', 'biceps', 'core'],
  lower: ['quads', 'posterior', 'calves'],
  legs: ['quads', 'posterior', 'calves'],
  chest: ['chest'],
  back: ['back'],
  shoulders: ['shoulders'],
  arms: ['biceps', 'triceps'],
  core: ['core'],
};

const REQUIRED_SLOT_LABELS = {
  quads: 'cvadriceps',
  posterior: 'fesieri/femurali',
  chest: 'piept',
  back: 'spate',
  shoulders: 'umeri',
  triceps: 'triceps',
  biceps: 'biceps',
  rear_delts: 'umeri posteriori',
  calves: 'gambe',
  core: 'abdomen',
  arms: 'brațe',
};

const SLOT_DB_GROUP_VALUES = {
  chest: ['chest', 'piept', 'pectorali'],
  back: ['back', 'spate', 'lats', 'dorsali', 'traps', 'trapeze'],
  shoulders: ['shoulders', 'umeri', 'deltoizi'],
  rear_delts: ['rear_delts', 'umeri posteriori', 'deltoizi posteriori'],
  triceps: ['triceps', 'arms', 'brate', 'brațe'],
  biceps: ['biceps', 'arms', 'brate', 'brațe'],
  arms: ['arms', 'brate', 'brațe', 'biceps', 'triceps'],
  quads: ['quads', 'quadriceps', 'cvadriceps', 'legs', 'picioare'],
  posterior: ['hamstrings', 'femurali', 'biceps femural', 'glutes', 'fesieri', 'glutei'],
  calves: ['calves', 'gambe', 'gamba'],
  core: ['core', 'abs', 'abdomen', 'abdominali', 'abdomene'],
};

function addCaseVariants(values) {
  const variants = new Set();
  for (const value of values || []) {
    const clean = String(value || '').trim();
    if (!clean) continue;
    variants.add(clean);
    variants.add(clean.toLowerCase());
    variants.add(clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase());
  }
  return [...variants];
}

function getDbMuscleGroupsForFocus(focus) {
  if (!focus || focus === 'fullBody') return null;

  const slots = FOCUS_ALLOWED_SLOTS[focus] || FOCUS_REQUIRED_SLOTS[focus] || [];
  const values = new Set(FOCUS_GROUPS[focus] || []);
  for (const slot of slots) {
    for (const value of SLOT_DB_GROUP_VALUES[slot] || []) values.add(value);
  }

  return addCaseVariants([...values]);
}

function normalizeTrainingSplit(value) {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase();
  if (!key) return 'Push/Pull/Legs';
  if (['full body', 'full-body', 'full_body', 'fullbody'].includes(key)) return 'Full Body';
  if (['push/pull/legs', 'push pull legs', 'push-pull-legs', 'push_pull_legs', 'ppl'].includes(key)) return 'Push/Pull/Legs';
  if (['upper/lower', 'upper lower', 'upper-lower', 'upper_lower'].includes(key)) return 'Upper/Lower';
  if (['bro split', 'bro-split', 'bro_split'].includes(key)) return 'Upper/Lower/Push/Pull/Legs';
  if (
    ['upper/lower/push/pull/legs', 'upper lower push pull legs', 'upper-lower-push-pull-legs', 'upper_lower_push_pull_legs', 'ulppl']
      .includes(key)
  ) return 'Upper/Lower/Push/Pull/Legs';
  return raw;
}

/**
 * How many times per week the given focus is trained for a split.
 * Used to scale per-session volume: more frequent = fewer sets/exercises per session.
 */
function getSessionFrequency(focus, trainingSplit) {
  switch (normalizeTrainingSplit(trainingSplit)) {
    case 'Full Body':
      return 3; // All muscles trained every session, ~3×/week
    case 'Push/Pull/Legs':
      return 2; // Push 2×, Pull 2×, Legs 2× (6 sessions)
    case 'Upper/Lower':
      return 2; // Upper 2×, Lower 2×
    case 'Upper/Lower/Push/Pull/Legs':
      return 2; // Muscles overlap between Upper and Push/Pull → ~2×/week
    default:
      return 2;
  }
}

/**
 * Number of exercises to select for a session, scaled by training frequency.
 * High frequency → fewer exercises per session (total weekly volume stays sane).
 */
function getFocusCount(focus, frequency) {
  const base = FOCUS_COUNTS_BASE[focus] || 6;
  const requiredCount = FOCUS_REQUIRED_SLOTS[focus]?.length || 0;
  if (frequency >= 3) return Math.max(requiredCount, Math.round(base * 0.67)); // 3×/week, but never below required coverage
  if (frequency === 1) return Math.max(requiredCount, base);                   // 1×/week → full list
  return Math.max(requiredCount, 5, Math.round(base * 0.83));                  // 2×/week → ~5 exercises
}

function getSessionFocuses(trainingSplit, workoutsPerWeek = 3) {
  const split = normalizeTrainingSplit(trainingSplit);
  const workouts = Math.max(2, Math.min(5, Number(workoutsPerWeek) || 3));

  if (split === 'Upper/Lower/Push/Pull/Legs') {
    return ['upper', 'lower', 'push', 'pull', 'legs'].slice(0, workouts);
  }

  if (split === 'Push/Pull/Legs') {
    const patterns = {
      2: ['push', 'pull'],
      3: ['push', 'pull', 'legs'],
      4: ['push', 'pull', 'legs', 'upper'],
      5: ['push', 'pull', 'legs', 'push', 'pull'],
    };
    return patterns[workouts] || patterns[3];
  }

  if (split === 'Upper/Lower') {
    const patterns = {
      2: ['upper', 'lower'],
      3: ['upper', 'lower', 'upper'],
      4: ['upper', 'lower', 'upper', 'lower'],
      5: ['upper', 'lower', 'upper', 'lower', 'upper'],
    };
    return patterns[workouts] || patterns[4];
  }

  if (split === 'Full Body') {
    return Array.from({ length: workouts }, () => 'fullBody');
  }

  return Array.from({ length: workouts }, (_, idx) => (idx % 2 === 0 ? 'upper' : 'lower'));
}

function getWorkoutWeekSchedule(workoutsPerWeek = 3) {
  const workouts = Math.max(2, Math.min(5, Number(workoutsPerWeek) || 3));
  const schedules = {
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 4],
  };
  return schedules[workouts] || schedules[3];
}

function resolveAutoFocus(trainingSplit, currentPlanDay = 0, workoutsPerWeek = 3) {
  const dayIndex = Math.max(0, Math.min(6, Number(currentPlanDay) || 0));
  const scheduledWorkoutDays = getWorkoutWeekSchedule(workoutsPerWeek);
  const workoutSlotIndex = scheduledWorkoutDays.indexOf(dayIndex);

  if (workoutSlotIndex === -1) {
    return {
      focus: 'rest',
      isRestDay: true,
      workoutSlotIndex: null,
      scheduledWorkoutDays,
    };
  }

  const focuses = getSessionFocuses(trainingSplit, workoutsPerWeek);
  return {
    focus: focuses[workoutSlotIndex % focuses.length] || focuses[0] || 'fullBody',
    isRestDay: false,
    workoutSlotIndex,
    scheduledWorkoutDays,
  };
}

/**
 * Prescribe sets/reps/rest for a single exercise.
 *
 * Sets are scaled down when weekly frequency is high to prevent excessive volume.
 * Example: back trained 2×/week on PPL → 3 sets/exercise × 3 back exercises × 2 sessions = 18 sets/week
 * vs 5 sets × 5 back exercises × 2 sessions = 50 sets — way too much.
 */
function prescribe(row, fitnessLevel, fitnessGoal, weeklyFrequency, isPaired = false) {
  const compound = row.is_compound !== false;

  // Base sets before frequency scaling
  const baseSets =
    fitnessLevel === 'beginner'  ? (compound ? 3 : 2) :
    fitnessLevel === 'advanced'  ? (compound ? 5 : 4) :
                                   (compound ? 4 : 3); // intermediate

  // Scale sets by weekly training frequency
  const freqMult =
    weeklyFrequency >= 3 ? 0.67 :
    weeklyFrequency === 1 ? 1.0  : 0.8;

  let sets = Math.max(2, Math.round(baseSets * freqMult));

  // When pairing 2 exercises per muscle group, halve sets per exercise
  if (isPaired) sets = Math.max(2, Math.ceil(sets / 2));

  let reps, restSeconds;

  if (fitnessGoal === 'strength') {
    reps        = compound ? '3-5'   : '6-8';
    restSeconds = compound ? 180     : 120;
  } else if (fitnessGoal === 'weight_loss' || fitnessGoal === 'endurance') {
    reps        = compound ? '12-15' : '15-20';
    restSeconds = compound ? 60      : 45;
    sets        = Math.max(2, sets - 1);
  } else {
    // Hypertrophy / muscle_gain
    reps        = row.default_reps || (compound ? '8-12' : '10-15');
    restSeconds = Number(row.default_rest_seconds) || (compound ? 90 : 60);
  }

  return { sets, reps, restSeconds };
}

/**
 * FOCUS_STRUCTURE: focus → array of muscle-group blocks.
 * Each block:
 *   group   – identifier
 *   large   – if true: pick 2 exercises (1 compound pattern + 1 isolation pattern),
 *             each prescribe()d with isPaired=true → sets halved.
 *             if false: pick 1 exercise, full sets.
 *   patterns – { patternKey: [[name, muscleRo, reps, restSec, isCompound], ...] }
 * Each session one option is chosen RANDOMLY from within each pattern.
 */
const FOCUS_STRUCTURE = {
  push: [
    { group: 'chest', large: true, patterns: {
      press_plat: [
        ['Flotări', 'Piept', '8-15', 60, true],
        ['Împins cu gantere pe bancă', 'Piept', '8-12', 90, true],
        ['Împins cu bara pe bancă', 'Piept', '6-10', 120, true],
      ],
      press_inclinat: [
        ['Împins inclinat cu gantere', 'Piept superior', '8-12', 90, true],
        ['Flotări cu picioarele ridicate', 'Piept superior', '8-12', 75, true],
      ],
      fluturare: [
        ['Fluturări cu gantere', 'Piept', '10-15', 60, false],
        ['Crossover la cablu', 'Piept', '12-15', 45, false],
        ['Pec deck', 'Piept', '12-15', 45, false],
      ],
    }},
    { group: 'shoulders', large: true, patterns: {
      press: [
        ['Presă umeri cu gantere', 'Umeri', '8-12', 90, true],
        ['Presă Arnold', 'Umeri', '8-12', 90, true],
        ['Presă militară cu bara', 'Umeri', '6-10', 120, true],
      ],
      laterale: [
        ['Ridicări laterale cu gantere', 'Umeri', '12-15', 60, false],
        ['Ridicări laterale la cablu', 'Umeri', '12-15', 60, false],
      ],
    }},
    { group: 'triceps', large: false, patterns: {
      extensii: [
        ['Extensii triceps la cablu', 'Triceps', '10-15', 60, false],
        ['Skull crushers', 'Triceps', '10-12', 75, false],
        ['Dips', 'Triceps', '8-12', 90, true],
        ['Extensii triceps cu gantera', 'Triceps', '10-15', 60, false],
      ],
    }},
  ],
  pull: [
    { group: 'back', large: true, patterns: {
      vertical: [
        ['Tracțiuni asistate la aparat', 'Spate', '6-10', 120, true],
        ['Pulldown la cablu', 'Spate', '10-12', 75, true],
        ['Pulldown cu priză îngustă', 'Spate', '10-12', 75, true],
      ],
      orizontal: [
        ['Ramat cu gantera', 'Spate', '8-12', 90, true],
        ['Ramat cu bara aplecat', 'Spate', '6-10', 120, true],
        ['Ramat la cablu', 'Spate', '10-12', 75, true],
      ],
      izolatie: [
        ['Pullover cu gantera', 'Spate', '10-12', 75, false],
        ['Pullover la cablu', 'Spate', '10-12', 75, false],
      ],
    }},
    { group: 'biceps', large: false, patterns: {
      flexii: [
        ['Flexii biceps cu gantere', 'Biceps', '10-12', 60, false],
        ['Flexii hammer', 'Biceps', '10-12', 60, false],
        ['Flexii cu bara', 'Biceps', '8-12', 75, false],
        ['Flexii concentrate', 'Biceps', '10-12', 60, false],
      ],
    }},
    { group: 'rear_delts', large: false, patterns: {
      posteriori: [
        ['Face pull la cablu', 'Umeri posteriori', '12-15', 60, false],
        ['Fluturări aplecate cu gantere', 'Umeri posteriori', '12-15', 60, false],
      ],
    }},
  ],
  legs: [
    { group: 'quads', large: true, patterns: {
      squat: [
        ['Genuflexiuni cu bara', 'Cvadriceps', '6-10', 120, true],
        ['Genuflexiuni cu gantere', 'Cvadriceps', '10-12', 90, true],
        ['Goblet squat', 'Cvadriceps', '10-12', 75, true],
        ['Leg press', 'Cvadriceps', '10-12', 90, true],
      ],
      unilateral: [
        ['Fandări cu gantere', 'Picioare', '8-10/picior', 90, true],
        ['Fandări bulgărești', 'Cvadriceps', '8-10/picior', 90, true],
        ['Step-up pe bancă', 'Picioare', '10-12/picior', 75, true],
      ],
    }},
    { group: 'posterior', large: true, patterns: {
      hip_hinge: [
        ['Hip thrust cu bara', 'Fesieri', '8-10', 90, true],
        ['Hip thrust cu gantera', 'Fesieri', '10-12', 90, true],
        ['Deadlift românesc', 'Femurali', '8-10', 120, true],
      ],
      izolatie: [
        ['Flexii femurali la aparat', 'Femurali', '10-15', 75, false],
        ['Flexii femurali culcat', 'Femurali', '10-12', 60, false],
      ],
    }},
    { group: 'calves', large: false, patterns: {
      gambe: [
        ['Ridicări pe vârfuri în picioare', 'Gambe', '15-20', 45, false],
        ['Ridicări pe vârfuri cu gantera', 'Gambe', '15-20', 45, false],
      ],
    }},
  ],
  upper: [
    { group: 'chest', large: true, patterns: {
      press: [
        ['Flotări', 'Piept', '8-15', 60, true],
        ['Împins cu gantere pe bancă', 'Piept', '8-12', 90, true],
        ['Împins inclinat cu gantere', 'Piept superior', '8-12', 90, true],
      ],
      fluturare: [
        ['Fluturări cu gantere', 'Piept', '10-15', 60, false],
        ['Crossover la cablu', 'Piept', '12-15', 45, false],
        ['Pec deck', 'Piept', '12-15', 45, false],
      ],
    }},
    { group: 'back', large: true, patterns: {
      vertical: [
        ['Pulldown la cablu', 'Spate', '10-12', 75, true],
        ['Tracțiuni asistate la aparat', 'Spate', '6-10', 120, true],
      ],
      orizontal: [
        ['Ramat cu gantera', 'Spate', '8-12', 90, true],
        ['Ramat la cablu', 'Spate', '10-12', 75, true],
        ['Ramat cu bara aplecat', 'Spate', '6-10', 120, true],
      ],
    }},
    { group: 'shoulders', large: false, patterns: {
      press_sau_laterale: [
        ['Presă umeri cu gantere', 'Umeri', '8-12', 90, true],
        ['Presă Arnold', 'Umeri', '8-12', 90, true],
        ['Ridicări laterale cu gantere', 'Umeri', '12-15', 60, false],
      ],
    }},
    { group: 'biceps', large: false, patterns: {
      flexii: [
        ['Flexii biceps cu gantere', 'Biceps', '10-12', 60, false],
        ['Flexii hammer', 'Biceps', '10-12', 60, false],
        ['Flexii cu bara', 'Biceps', '8-12', 75, false],
      ],
    }},
    { group: 'triceps', large: false, patterns: {
      extensii: [
        ['Extensii triceps la cablu', 'Triceps', '10-15', 60, false],
        ['Dips', 'Triceps', '8-12', 90, true],
        ['Skull crushers', 'Triceps', '10-12', 75, false],
      ],
    }},
  ],
  lower: [
    { group: 'quads', large: true, patterns: {
      squat: [
        ['Genuflexiuni cu bara', 'Cvadriceps', '6-10', 120, true],
        ['Goblet squat', 'Cvadriceps', '10-12', 75, true],
        ['Leg press', 'Cvadriceps', '10-12', 90, true],
      ],
      unilateral: [
        ['Fandări cu gantere', 'Picioare', '8-10/picior', 90, true],
        ['Fandări bulgărești', 'Cvadriceps', '8-10/picior', 90, true],
      ],
    }},
    { group: 'posterior', large: true, patterns: {
      hip_hinge: [
        ['Hip thrust cu bara', 'Fesieri', '8-10', 90, true],
        ['Deadlift românesc', 'Femurali', '8-10', 120, true],
        ['Hip thrust cu gantera', 'Fesieri', '10-12', 90, true],
      ],
      izolatie: [
        ['Flexii femurali la aparat', 'Femurali', '10-15', 75, false],
        ['Flexii femurali culcat', 'Femurali', '10-12', 60, false],
      ],
    }},
    { group: 'calves', large: false, patterns: {
      gambe: [
        ['Ridicări pe vârfuri în picioare', 'Gambe', '15-20', 45, false],
        ['Ridicări pe vârfuri cu gantera', 'Gambe', '15-20', 45, false],
      ],
    }},
  ],
  fullBody: [
    { group: 'chest', large: false, patterns: {
      press: [
        ['Flotări', 'Piept', '8-15', 60, true],
        ['Împins cu gantere pe bancă', 'Piept', '8-12', 90, true],
      ],
    }},
    { group: 'back', large: false, patterns: {
      ramat: [
        ['Ramat cu gantera', 'Spate', '8-12', 90, true],
        ['Pulldown la cablu', 'Spate', '10-12', 75, true],
        ['Ramat cu bara aplecat', 'Spate', '6-10', 120, true],
      ],
    }},
    { group: 'quads', large: false, patterns: {
      squat: [
        ['Genuflexiuni cu bara', 'Cvadriceps', '6-10', 120, true],
        ['Goblet squat', 'Cvadriceps', '10-12', 75, true],
        ['Leg press', 'Cvadriceps', '10-12', 90, true],
      ],
    }},
    { group: 'posterior', large: false, patterns: {
      hip_hinge: [
        ['Hip thrust cu bara', 'Fesieri', '8-10', 90, true],
        ['Deadlift românesc', 'Femurali', '8-10', 120, true],
        ['Hip thrust cu gantera', 'Fesieri', '10-12', 90, true],
      ],
    }},
    { group: 'shoulders', large: false, patterns: {
      press_sau_laterale: [
        ['Presă umeri cu gantere', 'Umeri', '8-12', 90, true],
        ['Ridicări laterale cu gantere', 'Umeri', '12-15', 60, false],
      ],
    }},
    { group: 'core', large: false, patterns: {
      core: [
        ['Plank', 'Core', '30-45s', 45, false],
        ['Mountain climbers', 'Core', '20', 30, false],
        ['Dead bug', 'Core', '10/parte', 45, false],
      ],
    }},
  ],
  chest: [
    { group: 'chest', large: true, patterns: {
      press_plat: [
        ['Flotări', 'Piept', '8-15', 60, true],
        ['Împins cu gantere pe bancă', 'Piept', '8-12', 90, true],
        ['Împins cu bara pe bancă', 'Piept', '6-10', 120, true],
      ],
      press_inclinat: [
        ['Împins inclinat cu gantere', 'Piept superior', '8-12', 90, true],
        ['Flotări cu picioarele ridicate', 'Piept superior', '8-12', 75, true],
      ],
      fluturare: [
        ['Fluturări cu gantere', 'Piept', '10-15', 60, false],
        ['Crossover la cablu', 'Piept', '12-15', 45, false],
        ['Pec deck', 'Piept', '12-15', 45, false],
      ],
    }},
    { group: 'triceps', large: false, patterns: {
      extensii: [
        ['Dips', 'Triceps', '8-12', 90, true],
        ['Extensii triceps la cablu', 'Triceps', '10-15', 60, false],
      ],
    }},
  ],
  back: [
    { group: 'back', large: true, patterns: {
      vertical: [
        ['Tracțiuni asistate la aparat', 'Spate', '6-10', 120, true],
        ['Pulldown la cablu', 'Spate', '10-12', 75, true],
        ['Pulldown cu priză îngustă', 'Spate', '10-12', 75, true],
      ],
      orizontal: [
        ['Ramat cu gantera', 'Spate', '8-12', 90, true],
        ['Ramat cu bara aplecat', 'Spate', '6-10', 120, true],
        ['Ramat la cablu', 'Spate', '10-12', 75, true],
      ],
      izolatie: [
        ['Pullover cu gantera', 'Spate', '10-12', 75, false],
        ['Face pull la cablu', 'Umeri posteriori', '12-15', 60, false],
      ],
    }},
    { group: 'biceps', large: false, patterns: {
      flexii: [
        ['Flexii biceps cu gantere', 'Biceps', '10-12', 60, false],
        ['Flexii hammer', 'Biceps', '10-12', 60, false],
        ['Flexii cu bara', 'Biceps', '8-12', 75, false],
      ],
    }},
  ],
  shoulders: [
    { group: 'shoulders', large: true, patterns: {
      press: [
        ['Presă umeri cu gantere', 'Umeri', '8-12', 90, true],
        ['Presă Arnold', 'Umeri', '8-12', 90, true],
        ['Presă militară cu bara', 'Umeri', '6-10', 120, true],
      ],
      laterale: [
        ['Ridicări laterale cu gantere', 'Umeri', '12-15', 60, false],
        ['Ridicări laterale la cablu', 'Umeri', '12-15', 60, false],
      ],
      fata: [
        ['Ridicări față cu gantere', 'Umeri anteriori', '10-12', 60, false],
        ['Ridicări față la cablu', 'Umeri anteriori', '10-12', 60, false],
      ],
      posteriori: [
        ['Face pull la cablu', 'Umeri posteriori', '12-15', 60, false],
        ['Fluturări aplecate cu gantere', 'Umeri posteriori', '12-15', 60, false],
      ],
    }},
  ],
  arms: [
    { group: 'biceps', large: true, patterns: {
      flexii: [
        ['Flexii biceps cu gantere', 'Biceps', '10-12', 60, false],
        ['Flexii cu bara', 'Biceps', '8-12', 75, false],
      ],
      hammer: [
        ['Flexii hammer', 'Biceps', '10-12', 60, false],
        ['Flexii concentrate', 'Biceps', '10-12', 60, false],
      ],
    }},
    { group: 'triceps', large: true, patterns: {
      compound: [
        ['Dips', 'Triceps', '8-12', 90, true],
        ['Skull crushers', 'Triceps', '10-12', 75, false],
      ],
      extensii: [
        ['Extensii triceps la cablu', 'Triceps', '10-15', 60, false],
        ['Extensii triceps cu gantera', 'Triceps', '10-15', 60, false],
        ['Kickbacks triceps', 'Triceps', '12-15', 45, false],
      ],
    }},
  ],
  core: [
    { group: 'core', large: true, patterns: {
      static: [
        ['Plank', 'Core', '30-45s', 45, false],
        ['Plank lateral', 'Core', '30s/parte', 45, false],
      ],
      dinamic: [
        ['Mountain climbers', 'Core', '20', 30, false],
        ['Dead bug', 'Core', '10/parte', 45, false],
        ['Bicycle crunch', 'Abdomen', '15-20', 30, false],
      ],
      crunch: [
        ['Crunch', 'Abdomen', '15-20', 30, false],
        ['Reverse crunch', 'Abdomen', '15-20', 30, false],
        ['Crunch la cablu', 'Abdomen', '15-20', 30, false],
      ],
    }},
  ],
};

// Muscle groups considered "large" per focus for DB-path selection (pick 2 exercises: 1 compound + 1 isolation)
const LARGE_MUSCLE_GROUPS = {
  push:     new Set(['chest', 'shoulders']),
  pull:     new Set(['back']),
  legs:     new Set(['quads', 'legs', 'hamstrings', 'glutes']),
  upper:    new Set(['chest', 'back']),
  lower:    new Set(['quads', 'legs', 'hamstrings', 'glutes']),
  fullBody: new Set(),
  chest:    new Set(['chest']),
  back:     new Set(['back']),
  shoulders: new Set(['shoulders']),
  arms:     new Set(['biceps', 'triceps']),
  core:     new Set(),
};

const FOCUS_GROUP_PRIORITY = {
  lower: ['quads', 'legs', 'glutes', 'hamstrings', 'calves', 'core'],
  legs: ['quads', 'legs', 'glutes', 'hamstrings', 'calves', 'core'],
  upper: ['chest', 'back', 'shoulders', 'triceps', 'biceps', 'rear_delts', 'arms', 'core'],
  push: ['chest', 'shoulders', 'triceps', 'arms', 'core'],
  pull: ['back', 'biceps', 'rear_delts', 'arms'],
  fullBody: ['chest', 'back', 'shoulders', 'arms', 'triceps', 'biceps', 'quads', 'glutes', 'hamstrings', 'core'],
};

const FOCUS_GROUP_LIMITS = {
  lower: { quads: 2, legs: 2, glutes: 1, hamstrings: 1, calves: 1, core: 1 },
  legs: { quads: 2, legs: 2, glutes: 1, hamstrings: 1, calves: 1, core: 1 },
  push: { chest: 2, shoulders: 2, triceps: 2, arms: 1, core: 1 },
  pull: { back: 2, biceps: 2, rear_delts: 1, arms: 1 },
  upper: { chest: 2, back: 2, shoulders: 1, triceps: 1, biceps: 1, rear_delts: 1, arms: 1, core: 1 },
  fullBody: { quads: 1, legs: 1, glutes: 1, hamstrings: 1, chest: 1, back: 1, shoulders: 1, core: 1, triceps: 1, biceps: 1, arms: 1 },
};

function rowIdentity(row) {
  return row?.id || row?.name || row?.name_ro || JSON.stringify(row);
}

function getFocusGroupLimit(focus, group, hasMultipleGroups) {
  const limit = FOCUS_GROUP_LIMITS[focus]?.[group];
  if (Number.isFinite(limit)) return limit;
  return hasMultipleGroups ? 2 : Infinity;
}

function isLowerBodyGroup(group) {
  return ['quads', 'legs', 'glutes', 'hamstrings', 'calves'].includes(normalizeMuscleGroup(group));
}

function pickRowFromGroup(groupRows, usedRows, preferCompound = null) {
  const available = (groupRows || []).filter(row => !usedRows.has(rowIdentity(row)));
  if (available.length === 0) return null;
  if (preferCompound === true) return available.find(row => row.is_compound !== false) || available[0];
  if (preferCompound === false) return available.find(row => row.is_compound === false) || available[0];
  return available[0];
}

function rowSearchText(row) {
  return normalizeTextKey([
    row?.name,
    row?.name_ro,
    row?.muscle_group,
  ].filter(Boolean).join(' '));
}

function textHasAny(text, terms) {
  return terms.some(term => text.includes(normalizeTextKey(term)));
}

const HOME_HIGH_IMPACT_TERMS = [
  'burpee',
  'jump',
  'sarit',
  'saritura',
  'plyo',
  'exploziv',
  'mountain climber',
  'jumping jack',
];

const HOME_COMPLEX_BODYWEIGHT_TERMS = [
  'flotari',
  'push up',
  'pushup',
  'tractiuni',
  'pull up',
  'pullup',
  'dips',
  'pistol squat',
  'handstand',
];

const HOME_DUMBBELL_EQUIPMENT_TERMS = [
  'dumbbell',
  'dumbbells',
  'dumbbells only',
  'dumbbells_only',
  'gantera',
  'gantere',
];

const HOME_BENCH_PRESS_TERMS = [
  'bench press',
  'dumbbell bench press',
  'incline dumbbell press',
  'decline dumbbell press',
  'impins cu gantere la piept',
  'impins cu gantere din culcat',
  'impins cu gantere pe banca',
  'impins inclinat cu gantere',
  'fluturari cu gantere pe banca',
  'fluturari cu gantere din culcat',
  'dumbbell fly',
  'dumbbell chest fly',
];

const HOME_EASY_MODIFIER_TERMS = [
  'la perete',
  'inclinat',
  'inclinate',
  'pe genunchi',
  'genunchi',
  'asistat',
  'asistate',
  'scapular',
];

function rowHasEasyModifier(row) {
  return textHasAny(rowSearchText(row), HOME_EASY_MODIFIER_TERMS);
}

function isHighImpactHomeExercise(row) {
  return textHasAny(rowSearchText(row), HOME_HIGH_IMPACT_TERMS);
}

function isComplexBodyweightExercise(row) {
  const text = rowSearchText(row);
  return textHasAny(text, HOME_COMPLEX_BODYWEIGHT_TERMS) && !rowHasEasyModifier(row);
}

function isDumbbellExercise(row) {
  const equipment = normalizeTextKey(row?.equipment);
  return HOME_DUMBBELL_EQUIPMENT_TERMS.some(term => equipment.includes(normalizeTextKey(term))) ||
    textHasAny(rowSearchText(row), HOME_DUMBBELL_EQUIPMENT_TERMS);
}

function isHomeUnsupportedDumbbellExercise(row) {
  if (!isDumbbellExercise(row)) return false;

  const text = rowSearchText(row);
  const requiresBenchForPress =
    textHasAny(text, ['banca', 'bench', 'inclinat', 'inclinate', 'declinat', 'culcat', 'culcata']) &&
    textHasAny(text, ['impins', 'press', 'fluturari', 'fly']) &&
    textHasAny(text, ['piept', 'chest', 'pectorali']);

  return requiresBenchForPress || textHasAny(text, HOME_BENCH_PRESS_TERMS);
}

function getExerciseSuitabilityScore(row, profile) {
  if (!profile?.isHome) return 0;

  let score = 0;
  if (rowHasEasyModifier(row)) score -= 6;
  if (isHighImpactHomeExercise(row)) score += profile.isBeginner ? 7 : 3;
  if (isComplexBodyweightExercise(row)) score += profile.needsLowImpact ? 10 : 1;

  if (profile.needsLowImpact) {
    const text = rowSearchText(row);
    if (textHasAny(text, ['glute bridge', 'pod fesier', 'dead bug', 'plank', 'bird dog', 'ridicari laterale', 'abductii', 'calf raise', 'ridicari pe varfuri'])) {
      score -= 3;
    }
  }

  return score;
}

function filterExercisesForProfile(rows, profile, focus) {
  if (!profile?.isHome || !Array.isArray(rows) || rows.length === 0) return rows || [];

  const requiredSlots = FOCUS_REQUIRED_SLOTS[focus] || [];
  const keepRequiredCoverage = (candidateRows) => requiredSlots.every(slot =>
    candidateRows.some(row => rowMatchesSlot(row, slot))
  );

  let filtered = rows.filter(row =>
    !isHighImpactHomeExercise(row) &&
    !isHomeUnsupportedDumbbellExercise(row)
  );

  if (profile.needsLowImpact) {
    const lowImpactRows = filtered.filter(row => !isComplexBodyweightExercise(row));
    if (lowImpactRows.length > 0) {
      filtered = lowImpactRows;
    }
  }

  if (!keepRequiredCoverage(filtered)) {
    for (const slot of requiredSlots) {
      if (filtered.some(row => rowMatchesSlot(row, slot))) continue;
      const fallback = [...rows]
        .filter(row => (
          rowMatchesSlot(row, slot) &&
          !isHighImpactHomeExercise(row) &&
          !isHomeUnsupportedDumbbellExercise(row) &&
          (!profile.needsLowImpact || !isComplexBodyweightExercise(row))
        ))
        .sort((a, b) => getExerciseSuitabilityScore(a, profile) - getExerciseSuitabilityScore(b, profile))[0];
      if (fallback) filtered.push(fallback);
    }
  }

  return [...filtered].sort((a, b) => getExerciseSuitabilityScore(a, profile) - getExerciseSuitabilityScore(b, profile));
}

function rowMatchesSlot(row, slot) {
  const group = normalizeMuscleGroup(row?.muscle_group);
  const text = rowSearchText(row);
  const isLowerBody = isLowerBodyGroup(group);
  const isUpperBodySlot = ['chest', 'back', 'shoulders', 'rear_delts', 'triceps', 'biceps', 'arms'].includes(slot);

  if (isUpperBodySlot && isLowerBody) return false;

  switch (slot) {
    case 'chest':
      return group === 'chest' || textHasAny(text, ['piept', 'bench', 'impins', 'flotari', 'pec deck', 'crossover', 'fluturari']);
    case 'back':
      return ['back', 'lats', 'traps'].includes(group) || textHasAny(text, ['spate', 'ramat', 'row', 'pulldown', 'tractiuni', 'pull over']);
    case 'shoulders':
      return group === 'shoulders' || textHasAny(text, ['press militar', 'presa umeri', 'shoulder press', 'ridicari laterale', 'lateral raise']);
    case 'rear_delts':
      return group === 'rear_delts' || textHasAny(text, ['umeri posteriori', 'deltoid posterior', 'face pull', 'reverse fly', 'fluturari inverse']);
    case 'triceps':
      return group === 'triceps' || (group === 'arms' && textHasAny(text, ['triceps', 'dips', 'extensii', 'pushdown', 'skull']));
    case 'biceps':
      return group === 'biceps' || (group === 'arms' && textHasAny(text, ['biceps', 'flexii', 'curl', 'hammer']));
    case 'arms':
      return ['arms', 'biceps', 'triceps'].includes(group) || textHasAny(text, ['biceps', 'triceps', 'flexii', 'curl', 'hammer', 'dips', 'extensii', 'pushdown']);
    case 'quads':
      return ['quads', 'quadriceps'].includes(group) || textHasAny(text, ['cvadriceps', 'genuflexiuni', 'squat', 'leg press', 'presa picioare', 'fandari', 'split squat', 'step up', 'leg extension', 'extensii picioare']);
    case 'posterior':
      return ['hamstrings', 'glutes'].includes(group) || textHasAny(text, ['femural', 'biceps femural', 'leg curl', 'flexii femurale', 'hip thrust', 'pod fesier', 'glute', 'fesier', 'rdl', 'deadlift', 'indreptari']);
    case 'calves':
      return group === 'calves' || textHasAny(text, ['gambe', 'calf', 'ridicari pe varfuri', 'varfuri']);
    case 'core':
      return ['core', 'abs'].includes(group) || textHasAny(text, ['abdomen', 'plank', 'crunch', 'dead bug', 'mountain climber']);
    default:
      return group === slot;
  }
}

function rowAllowedForFocus(row, focus) {
  if (!focus || focus === 'fullBody') return true;
  const allowedSlots = FOCUS_ALLOWED_SLOTS[focus];
  if (allowedSlots) return allowedSlots.some(slot => rowMatchesSlot(row, slot));

  const allowedGroups = FOCUS_GROUPS[focus];
  if (!allowedGroups) return false;
  const group = normalizeMuscleGroup(row?.muscle_group);
  return allowedGroups.map(normalizeMuscleGroup).includes(group);
}

function slotPrefersCompound(slot) {
  if (['chest', 'back', 'shoulders', 'quads', 'posterior'].includes(slot)) return true;
  if (['biceps', 'triceps', 'rear_delts', 'calves', 'core'].includes(slot)) return false;
  return null;
}

function pickRowForSlot(rows, slot, usedRows) {
  const matchingRows = shuffle((rows || []).filter(row => rowMatchesSlot(row, slot)));
  return pickRowFromGroup(matchingRows, usedRows, slotPrefersCompound(slot));
}

function getRequiredSlotsForRows(rows, focus) {
  const requiredSlots = FOCUS_REQUIRED_SLOTS[focus] || [];
  return requiredSlots.filter(slot => (rows || []).some(row => rowMatchesSlot(row, slot)));
}

function getMissingRequiredSlots(rows, focus, profile = null, availableRows = rows) {
  const requiredSlots = profile?.needsLowImpact
    ? getRequiredSlotsForRows(availableRows, focus)
    : (FOCUS_REQUIRED_SLOTS[focus] || []);
  return requiredSlots.filter(slot => !rows.some(row => rowMatchesSlot(row, slot)));
}

function selectBalancedDbExercises(rows, focus, targetCount, profile = null) {
  const largeGroups = LARGE_MUSCLE_GROUPS[focus] || new Set();
  const priority = FOCUS_GROUP_PRIORITY[focus] || shuffle([...new Set(rows.map(row => normalizeMuscleGroup(row.muscle_group)))]);
  const requiredSlots = profile?.needsLowImpact
    ? getRequiredSlotsForRows(rows, focus)
    : (FOCUS_REQUIRED_SLOTS[focus] || []);
  const byMuscle = {};

  for (const row of rows) {
    const group = normalizeMuscleGroup(row.muscle_group);
    if (!byMuscle[group]) byMuscle[group] = [];
    byMuscle[group].push(row);
  }
  for (const group of Object.keys(byMuscle)) byMuscle[group] = shuffle(byMuscle[group]);

  const selected = [];
  const usedRows = new Set();
  const groupCounts = {};
  const addRow = (row, isPaired = false) => {
    if (!row || usedRows.has(rowIdentity(row)) || selected.length >= targetCount) return false;
    const group = normalizeMuscleGroup(row.muscle_group);
    if (focus === 'fullBody' && isLowerBodyGroup(group)) {
      const lowerBodyCount = selected.filter(item => isLowerBodyGroup(item.row?.muscle_group)).length;
      if (lowerBodyCount >= 2) return false;
    }
    selected.push({ row, isPaired });
    usedRows.add(rowIdentity(row));
    groupCounts[group] = (groupCounts[group] || 0) + 1;
    return true;
  };

  for (const slot of requiredSlots) {
    const row = pickRowForSlot(rows, slot, usedRows);
    addRow(row, slotPrefersCompound(slot) === true);
  }

  for (const group of priority) {
    if (selected.length >= targetCount) break;
    const row = pickRowFromGroup(byMuscle[group], usedRows, largeGroups.has(group) ? true : null);
    addRow(row, largeGroups.has(group));
  }

  for (const group of priority) {
    if (selected.length >= targetCount) break;
    if ((groupCounts[group] || 0) >= getFocusGroupLimit(focus, group, true)) continue;
    const row = pickRowFromGroup(byMuscle[group], usedRows, largeGroups.has(group) ? false : null);
    addRow(row, largeGroups.has(group));
  }

  const allRows = shuffle(rows);
  for (const row of allRows) {
    if (selected.length >= targetCount) break;
    const group = normalizeMuscleGroup(row.muscle_group);
    const hasMultipleGroups = Object.keys(byMuscle).length > 1;
    if ((groupCounts[group] || 0) >= getFocusGroupLimit(focus, group, hasMultipleGroups)) continue;
    addRow(row, largeGroups.has(group));
  }

  for (const row of allRows) {
    if (selected.length >= Math.min(targetCount, rows.length)) break;
    addRow(row, largeGroups.has(normalizeMuscleGroup(row.muscle_group)));
  }

  const finalSelection = selected.slice(0, targetCount);
  if (focus === 'push' || focus === 'upper') {
    return [
      ...finalSelection.filter(item => !rowMatchesSlot(item.row, 'core')),
      ...finalSelection.filter(item => rowMatchesSlot(item.row, 'core')),
    ];
  }

  return finalSelection;
}

/**
 * Pick exercises from FOCUS_STRUCTURE fallback:
 * - Large muscle groups: pick 1 compound pattern + 1 isolation pattern (isPaired=true → sets halved).
 * - Small muscle groups: pick 1 random pattern (isPaired=false → full sets).
 */
function pickFromStructure(structure, targetCount) {
  const allPicked = [];
  for (const { large, patterns } of structure) {
    const patternKeys = Object.keys(patterns);
    if (large) {
      // Separate compound-dominant patterns from isolation-dominant ones
      const compoundKeys = shuffle(patternKeys.filter(k => patterns[k].some(o => o[4] === true)));
      const isoKeys      = shuffle(patternKeys.filter(k => patterns[k].every(o => o[4] === false)));
      // Pick 1 compound + 1 iso; if one side is missing, pick 2 from what's available
      const ordered = [...compoundKeys, ...isoKeys];
      for (const key of ordered.slice(0, 2)) {
        const opts = shuffle(patterns[key]);
        allPicked.push({ ex: opts[0], isPaired: true });
      }
    } else {
      const key = shuffle(patternKeys)[0];
      const opts = shuffle(patterns[key]);
      allPicked.push({ ex: opts[0], isPaired: false });
    }
  }
  // Trim to targetCount
  return allPicked.slice(0, targetCount);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const EXERCISE_SELECT_BASE = 'id, name, name_ro, muscle_group, is_compound, default_sets, default_reps, default_rest_seconds, equipment, notes';
const EXERCISE_SELECT_BASE_NO_NOTES = 'id, name, name_ro, muscle_group, is_compound, default_sets, default_reps, default_rest_seconds, equipment';
const EXERCISE_SELECT_WITH_DIFFICULTY = `${EXERCISE_SELECT_BASE}, difficulty_level`;
const EXERCISE_SELECT_WITH_VIDEO = `${EXERCISE_SELECT_WITH_DIFFICULTY}, video_url, video_storage_bucket, video_storage_path`;
const EXERCISE_SELECT_WITH_VIDEO_NO_DIFFICULTY = `${EXERCISE_SELECT_BASE}, video_url, video_storage_bucket, video_storage_path`;
const EXERCISE_SELECT_WITH_VIDEO_NO_NOTES = `${EXERCISE_SELECT_BASE_NO_NOTES}, difficulty_level, video_url, video_storage_bucket, video_storage_path`;
const EXERCISE_SELECT_WITH_VIDEO_MINIMAL = `${EXERCISE_SELECT_BASE_NO_NOTES}, video_url, video_storage_bucket, video_storage_path`;
const EXERCISE_ID_SELECT_BASE = 'id, name, name_ro, muscle_group, is_compound, default_sets, default_reps, default_rest_seconds, equipment, notes';
const EXERCISE_ID_SELECT_BASE_NO_NOTES = 'id, name, name_ro, muscle_group, is_compound, default_sets, default_reps, default_rest_seconds, equipment';
const EXERCISE_ID_SELECT_WITH_DIFFICULTY = `${EXERCISE_ID_SELECT_BASE}, difficulty_level`;
const EXERCISE_ID_SELECT_WITH_VIDEO = `${EXERCISE_ID_SELECT_WITH_DIFFICULTY}, video_url, video_storage_bucket, video_storage_path`;
const EXERCISE_ID_SELECT_WITH_VIDEO_NO_DIFFICULTY = `${EXERCISE_ID_SELECT_BASE}, video_url, video_storage_bucket, video_storage_path`;
const EXERCISE_ID_SELECT_WITH_VIDEO_NO_NOTES = `${EXERCISE_ID_SELECT_BASE_NO_NOTES}, difficulty_level, video_url, video_storage_bucket, video_storage_path`;
const EXERCISE_ID_SELECT_WITH_VIDEO_MINIMAL = `${EXERCISE_ID_SELECT_BASE_NO_NOTES}, video_url, video_storage_bucket, video_storage_path`;
const DEFAULT_EXERCISE_VIDEO_BUCKET = 'video-exercitii';
const EXERCISE_VIDEO_SIGNED_URL_TTL_SECONDS = 60 * 60 * 4;
const EXERCISE_VIDEO_CACHE_TTL_MS = 1000 * 60 * 60 * 3;
const MAX_SESSION_EXERCISES = 20;
const MAX_SESSION_PAYLOAD_BYTES = 128 * 1024;
const MAX_PATCH_PAYLOAD_BYTES = 8 * 1024;
const TREADMILL_CARDIO_EXERCISE_ID = '391ebc14-3229-425b-a980-fb1f7b729aa9';
const GENERAL_WARMUP_EXERCISE_ID = '66bead10-368d-4572-93f6-282b417ff5b2';
const MANDATORY_WARMUP_EXERCISE_IDS = new Set([TREADMILL_CARDIO_EXERCISE_ID, GENERAL_WARMUP_EXERCISE_ID]);
const exerciseVideoUrlCache = new Map();

function requestBodyTooLarge(request, maxBytes) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeExerciseVideoBucket(bucket) {
  return bucket === 'vide-exercitii'
    ? DEFAULT_EXERCISE_VIDEO_BUCKET
    : (bucket || DEFAULT_EXERCISE_VIDEO_BUCKET);
}

function isMandatoryWarmupExercise(value) {
  const sourceId = String(value?.sourceId || value?.id || '').trim();
  return value?.isWarmup === true || MANDATORY_WARMUP_EXERCISE_IDS.has(sourceId);
}

function isCardioExerciseRow(row) {
  const text = rowSearchText(row);
  const group = normalizeMuscleGroup(row?.muscle_group);
  return group === 'cardio' || textHasAny(text, [
    'cardio',
    'treadmill',
    'banda inclinata',
    'banda de alergare',
    'mers pe banda',
    'mersul pe banda',
    'alergare',
    'bicicleta',
    'eliptica',
  ]);
}

function isCoreSessionExercise(ex) {
  const text = normalizeTextKey([
    ex?.name,
    ex?.sourceName,
    ex?.muscleGroup,
    ex?.muscle,
  ].filter(Boolean).join(' '));

  if (!text || isMandatoryWarmupExercise(ex)) return false;
  return textHasAny(text, ['core', 'abdomen', 'abdomene', 'abs', 'plank', 'crunch', 'dead bug', 'bird dog']);
}

function orderWorkoutExercises(exercises) {
  const warmups = [];
  const regular = [];
  const core = [];
  const seenWarmups = new Set();

  for (const ex of exercises || []) {
    if (isMandatoryWarmupExercise(ex)) {
      const key = String(ex.sourceId || ex.id || ex.name || warmups.length);
      if (!seenWarmups.has(key)) {
        seenWarmups.add(key);
        warmups.push({ ...ex, isWarmup: true });
      }
      continue;
    }

    if (isCoreSessionExercise(ex)) {
      core.push(ex);
    } else {
      regular.push(ex);
    }
  }

  return [...warmups, ...regular, ...core].map((ex, index) => ({
    ...ex,
    id: index + 1,
  }));
}

function getExerciseVideoCacheKey(row) {
  if (!row?.video_storage_path) return row?.video_url || '';
  return [
    normalizeExerciseVideoBucket(row.video_storage_bucket),
    row.video_storage_path,
  ].join('|');
}

function readExerciseVideoCache(key) {
  const cached = exerciseVideoUrlCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    exerciseVideoUrlCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeExerciseVideoCache(key, value) {
  if (!key || !value) return value;
  exerciseVideoUrlCache.set(key, {
    value,
    expiresAt: Date.now() + EXERCISE_VIDEO_CACHE_TTL_MS,
  });

  if (exerciseVideoUrlCache.size > 700) {
    const now = Date.now();
    for (const [cacheKey, cacheValue] of exerciseVideoUrlCache.entries()) {
      if (cacheValue.expiresAt <= now || exerciseVideoUrlCache.size > 550) {
        exerciseVideoUrlCache.delete(cacheKey);
      }
    }
  }

  return value;
}

async function resolveExerciseVideoUrl(supabase, row) {
  const cacheKey = getExerciseVideoCacheKey(row);
  const cachedUrl = readExerciseVideoCache(cacheKey);
  if (cachedUrl) return cachedUrl;

  if (!row?.video_storage_path) {
    const videoUrl = row?.video_url
      ? row.video_url.replace('/vide-exercitii/', '/video-exercitii/')
      : null;
    return writeExerciseVideoCache(cacheKey, videoUrl);
  }

  const bucket = normalizeExerciseVideoBucket(row.video_storage_bucket);
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(row.video_storage_path, EXERCISE_VIDEO_SIGNED_URL_TTL_SECONDS);

  if (!error && data?.signedUrl) return writeExerciseVideoCache(cacheKey, data.signedUrl);

  console.error('Workout exercise signed video URL failed:', {
    bucket,
    path: row.video_storage_path,
    error,
  });
  const { data: publicData } = supabase.storage
    .from(bucket)
    .getPublicUrl(row.video_storage_path);

  return writeExerciseVideoCache(cacheKey, publicData?.publicUrl || null);
}

function hasExerciseVideo(row) {
  return Boolean(row?.videoUrl || row?.video_url || row?.video_storage_path);
}

function normalizeExerciseInstructions(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'object') {
    return Object.values(value).map(item => String(item || '').trim()).filter(Boolean);
  }
  return String(value)
    .split(/\r?\n|(?<=\.)\s+(?=[A-ZĂÂÎȘȚ])/)
    .map(item => item.replace(/^[-•\d.)\s]+/, '').trim())
    .filter(Boolean);
}

function hasLegacyVideoBucket(row) {
  return typeof row?.videoUrl === 'string' && row.videoUrl.includes('/vide-exercitii/');
}

function exerciseKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ăâ]/gi, 'a')
    .replace(/[î]/gi, 'i')
    .replace(/[șş]/gi, 's')
    .replace(/[țţ]/gi, 't')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getSessionExerciseKey(ex) {
  return exerciseKey(ex?.sourceName || ex?.name);
}

async function getDbVideoExerciseRows(supabase) {
  let { data, error } = await supabaseQuery(() => supabase
    .from('exercises')
    .select('name, name_ro, notes, video_url, video_storage_bucket, video_storage_path')
    .eq('active', true));

  if (error && /notes/i.test(String(error.message || ''))) {
    ({ data, error } = await supabaseQuery(() => supabase
      .from('exercises')
      .select('name, name_ro, video_url, video_storage_bucket, video_storage_path')
      .eq('active', true)));
  }

  if (error) {
    console.error('Workout video validation query failed:', error);
    return null;
  }

  return (data || []).filter(hasExerciseVideo);
}

function buildDbVideoExerciseMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const keys = [exerciseKey(row.name), exerciseKey(row.name_ro)].filter(Boolean);
    for (const key of keys) map.set(key, row);
  }
  return map;
}

async function hydrateExercisesWithDbVideos(supabase, exercises, dbVideoRows = null) {
  if (!Array.isArray(exercises) || exercises.length === 0) return null;

  const rows = dbVideoRows || await getDbVideoExerciseRows(supabase);
  if (!rows) return null;

  const dbMap = buildDbVideoExerciseMap(rows);
  const hydrated = [];
  for (const ex of exercises) {
    if (hasLegacyVideoBucket(ex)) return null;

    if (ex?.isWarmup === true) {
      hydrated.push(ex);
      continue;
    }

    const row = dbMap.get(getSessionExerciseKey(ex));
    if (!row) return null;

    const videoUrl = await resolveExerciseVideoUrl(supabase, row);
    if (!videoUrl) return null;

    hydrated.push({
      ...ex,
      sourceName: row.name,
      name: ex.name || row.name_ro || row.name,
      instructions: normalizeExerciseInstructions(row.notes),
      videoUrl,
    });
  }

  return hydrated;
}

function getWarmupExerciseIds(availableEquipment) {
  return availableEquipment === 'no equipment'
    ? [GENERAL_WARMUP_EXERCISE_ID]
    : [TREADMILL_CARDIO_EXERCISE_ID, GENERAL_WARMUP_EXERCISE_ID];
}

async function fetchExerciseRowsByIds(supabase, ids) {
  const cleanIds = (ids || []).map(id => String(id || '').trim()).filter(Boolean);
  if (!cleanIds.length) return { rows: [], error: null, missingVideoColumns: false };

  const buildQuery = (selectClause) => supabase
    .from('exercises')
    .select(selectClause)
    .in('id', cleanIds);

  let missingVideoColumns = false;
  let { data, error } = await supabaseQuery(() => buildQuery(EXERCISE_ID_SELECT_WITH_VIDEO));
  if (error && /video_url|video_storage_bucket|video_storage_path/i.test(String(error.message || ''))) {
    missingVideoColumns = true;
  } else if (error && /notes/i.test(String(error.message || ''))) {
    ({ data, error } = await supabaseQuery(() => buildQuery(EXERCISE_ID_SELECT_WITH_VIDEO_NO_NOTES)));
    if (error && /difficulty_level/i.test(String(error.message || ''))) {
      ({ data, error } = await supabaseQuery(() => buildQuery(EXERCISE_ID_SELECT_WITH_VIDEO_MINIMAL)));
    }
    if (error && /video_url|video_storage_bucket|video_storage_path/i.test(String(error.message || ''))) {
      missingVideoColumns = true;
    }
  } else if (error && /difficulty_level/i.test(String(error.message || ''))) {
    ({ data, error } = await supabaseQuery(() => buildQuery(EXERCISE_ID_SELECT_WITH_VIDEO_NO_DIFFICULTY)));
    if (error && /notes/i.test(String(error.message || ''))) {
      ({ data, error } = await supabaseQuery(() => buildQuery(EXERCISE_ID_SELECT_WITH_VIDEO_MINIMAL)));
    }
    if (error && /video_url|video_storage_bucket|video_storage_path/i.test(String(error.message || ''))) {
      missingVideoColumns = true;
    }
  }

  if (error || missingVideoColumns) {
    return { rows: [], error, missingVideoColumns };
  }

  const byId = new Map((data || []).map(row => [String(row.id), row]));
  return {
    rows: cleanIds.map(id => byId.get(id)).filter(Boolean),
    error: null,
    missingVideoColumns: false,
  };
}

async function buildWarmupExercises(supabase, availableEquipment) {
  const ids = getWarmupExerciseIds(availableEquipment);
  const { rows, error, missingVideoColumns } = await fetchExerciseRowsByIds(supabase, ids);

  if (missingVideoColumns) {
    return {
      response: NextResponse.json(
        { error: 'Coloanele pentru video-uri lipsesc din exercises. Rulează scriptul add-exercise-video-columns.sql.' },
        { status: 409 }
      ),
    };
  }

  if (error) {
    console.error('Workout warmup query failed:', error);
    return {
      response: NextResponse.json(
        { error: 'Nu am putut încărca încălzirea antrenamentului.' },
        { status: 500 }
      ),
    };
  }

  if (rows.length !== ids.length) {
    return {
      response: NextResponse.json(
        { error: 'Încălzirea obligatorie nu este complet configurată în baza de date.' },
        { status: 409 }
      ),
    };
  }

  const exercises = await Promise.all(rows.map(async (row, index) => {
    const isTreadmillCardio = String(row.id) === TREADMILL_CARDIO_EXERCISE_ID;
    return {
      id: index + 1,
      sourceId: row.id,
      sourceName: row.name,
      name: row.name_ro || row.name,
      muscleGroup: isTreadmillCardio ? 'Cardio' : (muscleRo(row.muscle_group) || 'Încălzire'),
      sets: 1,
      reps: isTreadmillCardio ? '5 min' : (row.default_reps || '5 min'),
      restSeconds: 0,
      instructions: normalizeExerciseInstructions(row.notes),
      videoUrl: await resolveExerciseVideoUrl(supabase, row),
      isWarmup: true,
    };
  }));

  return { exercises };
}

async function getWorkoutContext(supabase, userId, requestedFocus = 'auto') {
  const requestedWorkoutFocus = normalizeWorkoutFocus(requestedFocus) || 'auto';
  const { data: userRow } = await supabase
    .from('users')
    .select(`
      fitness_level,
      age,
      weight,
      gender,
      available_equipment,
      fitness_goal,
      training_split,
      workouts_per_week,
      current_plan_day,
      current_plan_day_due_at,
      meal_day_status,
      workout_day_status,
      streak_count,
      streak_state,
      streak_recovery_day,
      streak_awarded_day,
      weekly_plan_due_at
    `)
    .eq('id', userId)
    .maybeSingle();

  let dailyState = reconcileDailyPlanProgress(userRow, new Date());
  if (userRow && dailyState.changed) {
    await supabase
      .from('users')
      .update(buildDailyProgressUpdate(dailyState))
      .eq('id', userId);
  }

  const fitnessLevel = userRow?.fitness_level || 'beginner';
  const availableEquipment = normalizeAvailableEquipment(userRow?.available_equipment || 'full gym');
  const exerciseProfile = getExerciseProfile({
    age: userRow?.age,
    weight: userRow?.weight,
    gender: userRow?.gender,
    fitnessLevel,
    availableEquipment,
  });
  const fitnessGoal = userRow?.fitness_goal || 'muscle_gain';
  const isHomeWorkout = availableEquipment === 'no equipment';
  const trainingSplit = isHomeWorkout ? 'Full Body' : normalizeTrainingSplit(userRow?.training_split || 'Push/Pull/Legs');
  const workoutsPerWeek = Math.max(2, Math.min(5, Number(userRow?.workouts_per_week) || 3));
  const workoutDayIndex = Math.max(0, Math.min(6, Number(dailyState.currentPlanDay) || 0));
  const autoFocus = resolveAutoFocus(trainingSplit, workoutDayIndex, workoutsPerWeek);
  const isRestDay = requestedWorkoutFocus === 'auto' && autoFocus.isRestDay;
  const focus = isRestDay
    ? 'rest'
    : (requestedWorkoutFocus === 'auto'
      ? (isHomeWorkout ? 'fullBody' : autoFocus.focus)
      : requestedWorkoutFocus);
  const frequency = getSessionFrequency(focus, trainingSplit);
  const targetCount = isRestDay ? 0 : getFocusCount(focus, frequency);
  const warmupCount = isRestDay ? 0 : getWarmupExerciseIds(availableEquipment).length;

  return {
    fitnessLevel,
    availableEquipment,
    exerciseProfile,
    fitnessGoal,
    trainingSplit,
    workoutsPerWeek,
    workoutDayIndex,
    workoutSlotIndex: requestedWorkoutFocus === 'auto' ? autoFocus.workoutSlotIndex : null,
    scheduledWorkoutDays: requestedWorkoutFocus === 'auto' ? autoFocus.scheduledWorkoutDays : getWorkoutWeekSchedule(workoutsPerWeek),
    isRestDay,
    focus,
    frequency,
    targetCount,
    warmupCount,
    exerciseCount: targetCount + warmupCount,
  };
}

async function generateWorkoutExercises(supabase, context) {
  const {
    fitnessLevel,
    availableEquipment,
    exerciseProfile,
    fitnessGoal,
    trainingSplit,
    isRestDay,
    focus,
    frequency,
    targetCount,
  } = context;

  if (isRestDay) {
    return {
      response: NextResponse.json({
        isRestDay: true,
        focus: 'rest',
        trainingSplit,
        workoutDayIndex: context.workoutDayIndex,
        scheduledWorkoutDays: context.scheduledWorkoutDays,
        exerciseCount: 0,
        message: 'Azi este zi de odihnă.',
      }),
    };
  }

  const equipmentFilter = EQUIPMENT_FILTER[availableEquipment] || null;
  const muscleGroups = getDbMuscleGroupsForFocus(focus);
  const warmupResult = await buildWarmupExercises(supabase, availableEquipment);
  if (warmupResult.response) return warmupResult;
  const warmupExercises = warmupResult.exercises || [];

  const buildExerciseQuery = (selectClause) => {
    let q = supabase
      .from('exercises')
      .select(selectClause)
      .eq('active', true);

    if (equipmentFilter) {
      q = q.in('equipment', equipmentFilter);
    } else {
      q = q.not('equipment', 'in', `(${FULL_GYM_EXCLUDED_EQUIPMENT.map(e => `"${e}"`).join(',')})`);
    }
    if (muscleGroups) q = q.in('muscle_group', muscleGroups);
    return q;
  };

  let missingVideoColumns = false;
  let { data: rawRows, error } = await supabaseQuery(() => buildExerciseQuery(EXERCISE_SELECT_WITH_VIDEO));
  if (error && /video_url|video_storage_bucket|video_storage_path/i.test(String(error.message || ''))) {
    missingVideoColumns = true;
  } else if (error && /notes/i.test(String(error.message || ''))) {
    ({ data: rawRows, error } = await supabaseQuery(() => buildExerciseQuery(EXERCISE_SELECT_WITH_VIDEO_NO_NOTES)));
    if (error && /difficulty_level/i.test(String(error.message || ''))) {
      ({ data: rawRows, error } = await supabaseQuery(() => buildExerciseQuery(EXERCISE_SELECT_WITH_VIDEO_MINIMAL)));
    }
    if (error && /video_url|video_storage_bucket|video_storage_path/i.test(String(error.message || ''))) {
      missingVideoColumns = true;
    }
  } else if (error && /difficulty_level/i.test(String(error.message || ''))) {
    ({ data: rawRows, error } = await supabaseQuery(() => buildExerciseQuery(EXERCISE_SELECT_WITH_VIDEO_NO_DIFFICULTY)));
    if (error && /notes/i.test(String(error.message || ''))) {
      ({ data: rawRows, error } = await supabaseQuery(() => buildExerciseQuery(EXERCISE_SELECT_WITH_VIDEO_MINIMAL)));
    }
    if (error && /video_url|video_storage_bucket|video_storage_path/i.test(String(error.message || ''))) {
      missingVideoColumns = true;
    }
  }

  if (missingVideoColumns) {
    return {
      response: NextResponse.json(
        { error: 'Coloanele pentru video-uri lipsesc din exercises. Rulează scriptul add-exercise-video-columns.sql.' },
        { status: 409 }
      ),
    };
  }

  if (error) {
    console.error('Workout exercise video query failed:', error);
    return {
      response: NextResponse.json(
        { error: 'Nu am putut încărca exercițiile cu video.' },
        { status: 500 }
      ),
    };
  }

  const videoRows = (rawRows || [])
    .filter(hasExerciseVideo)
    .filter(row => !MANDATORY_WARMUP_EXERCISE_IDS.has(String(row?.id || '')))
    .filter(row => !isCardioExerciseRow(row))
    .filter(row => rowAllowedForFocus(row, focus));
  let rows = filterExercisesForProfile(videoRows, exerciseProfile, focus);
  if (rows && rows.length > 0) {
    const levelOrder = { beginner: 0, intermediate: 1, advanced: 2 };
    const userLevelNum = levelOrder[fitnessLevel] ?? 1;
    rows = rows.filter(r => {
      if (!r.difficulty_level) return true;
      const rowLevelNum = levelOrder[r.difficulty_level] ?? 0;
      return rowLevelNum <= userLevelNum;
    });
    if (rows.length < 4) rows = filterExercisesForProfile(videoRows, exerciseProfile, focus);
  }

  if (!rows || rows.length === 0) {
    return {
      response: NextResponse.json(
        { error: 'Nu există exerciții cu video disponibile pentru antrenamentul de azi.' },
        { status: 404 }
      ),
    };
  }

  const selected = selectBalancedDbExercises(rows, focus, targetCount, exerciseProfile);
  const missingRequiredSlots = getMissingRequiredSlots(selected.map(({ row }) => row), focus, exerciseProfile, rows);
  if (missingRequiredSlots.length > 0) {
    return {
      response: NextResponse.json(
        {
          error: `Nu există exerciții cu video pentru toate grupele obligatorii: ${missingRequiredSlots.map(slot => REQUIRED_SLOT_LABELS[slot] || slot).join(', ')}.`,
        },
        { status: 409 }
      ),
    };
  }

  const mainExercises = await Promise.all(selected.slice(0, targetCount).map(async ({ row, isPaired }, i) => {
    const { sets, reps, restSeconds } = prescribe(row, fitnessLevel, fitnessGoal, frequency, isPaired);
    return {
      id: warmupExercises.length + i + 1,
      name: row.name_ro || row.name,
      sourceName: row.name,
      muscleGroup: muscleRo(row.muscle_group),
      sets,
      reps,
      restSeconds,
      instructions: normalizeExerciseInstructions(row.notes),
      videoUrl: await resolveExerciseVideoUrl(supabase, row),
    };
  }));

  const exercises = orderWorkoutExercises([...warmupExercises, ...mainExercises]);

  return { exercises, focus, trainingSplit };
}

/**
 * GET /api/user/workout-session          → check for active (persisted) session
 * GET /api/user/workout-session?focus=push → generate exercises (checks active first)
 */
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'user' && auth.role !== 'client') return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const requestedFocusRaw = searchParams.get('focus');
  const requestedFocus = requestedFocusRaw ? normalizeWorkoutFocus(requestedFocusRaw) : null;
  if (requestedFocusRaw && !requestedFocus) {
    return NextResponse.json({ error: 'Focus antrenament invalid.' }, { status: 400 });
  }
  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: requestedFocus ? 'user-workout-session-generate' : 'user-workout-session-get',
    maxRequests: requestedFocus ? 30 : 90,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  const supabase = getSupabase();

  // ── No focus param: just return the persisted active session (if any) ──
  if (!requestedFocus) {
    const { data: sessionRow } = await supabase
      .from('users')
      .select('active_workout_session')
      .eq('id', auth.userId)
      .maybeSingle();

    const session = sessionRow?.active_workout_session;
    if (session) {
      const hydratedExercises = await hydrateExercisesWithDbVideos(supabase, session.exercises);
      if (!hydratedExercises) {
        await supabase.from('users').update({ active_workout_session: null }).eq('id', auth.userId);
        return NextResponse.json({ activeSession: null });
      }
      const orderedExercises = orderWorkoutExercises(hydratedExercises);
      const orderedSession = {
        ...session,
        exercises: orderedExercises,
        currentIndex: clampNumber(session.currentIndex, 0, orderedExercises.length, 0),
      };
      await supabase
        .from('users')
        .update({ active_workout_session: orderedSession })
        .eq('id', auth.userId);
      // Return stored elapsedSeconds — timer continues from last saved checkpoint
      return NextResponse.json({
        activeSession: orderedSession,
      });
    }
    return NextResponse.json({ activeSession: null });
  }

  const context = await getWorkoutContext(supabase, auth.userId, requestedFocus);

  if (searchParams.get('preview') === '1') {
    return NextResponse.json({
      isRestDay: context.isRestDay,
      focus: context.focus,
      trainingSplit: context.trainingSplit,
      availableEquipment: context.availableEquipment,
      workoutDayIndex: context.workoutDayIndex,
      workoutSlotIndex: context.workoutSlotIndex,
      scheduledWorkoutDays: context.scheduledWorkoutDays,
      exerciseCount: context.exerciseCount,
      message: context.isRestDay ? 'Azi este zi de odihnă.' : null,
    });
  }

  const generated = await generateWorkoutExercises(supabase, context);
  if (generated.response) return generated.response;

  return NextResponse.json({
    exercises: generated.exercises,
    focus: context.focus,
    trainingSplit: context.trainingSplit,
    workoutDayIndex: context.workoutDayIndex,
    exerciseCount: generated.exercises.length,
  });
}

/**
 * POST /api/user/workout-session
 * Body: { focus, exercises } or { focus, generate: true }
 * Saves a new workout session to DB (overwrites any existing one).
 */
export async function POST(request) {
  const { ip, userAgent } = getRequestMeta(request);
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'user' && auth.role !== 'client') return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-workout-session-start',
    maxRequests: 30,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  if (requestBodyTooLarge(request, MAX_SESSION_PAYLOAD_BYTES)) {
    return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
  }

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Body invalid.' }, { status: 400 }); }
  const { exercises, focus, generate } = body;
  const requestedFocus = normalizeWorkoutFocus(focus || (generate ? 'auto' : 'fullBody'));
  if (!requestedFocus) {
    return NextResponse.json({ error: 'Focus antrenament invalid.' }, { status: 400 });
  }

  const supabase = getSupabase();
  let resolvedFocus = requestedFocus === 'auto' ? 'fullBody' : requestedFocus;
  let resolvedWorkoutDayIndex = null;
  let hydratedExercises = null;

  if (generate) {
    const context = await getWorkoutContext(supabase, auth.userId, requestedFocus);
    if (context.isRestDay) {
      return NextResponse.json({
        error: 'Azi este zi de odihnă. Bifează recuperarea în loc să începi un antrenament.',
        isRestDay: true,
        focus: 'rest',
        workoutDayIndex: context.workoutDayIndex,
        scheduledWorkoutDays: context.scheduledWorkoutDays,
      }, { status: 409 });
    }
    const generated = await generateWorkoutExercises(supabase, context);
    if (generated.response) return generated.response;
    resolvedFocus = context.focus;
    resolvedWorkoutDayIndex = context.workoutDayIndex;
    hydratedExercises = generated.exercises;
  } else {
    if (!exercises?.length) return NextResponse.json({ error: 'Exerciții lipsă.' }, { status: 400 });
    if (!Array.isArray(exercises) || exercises.length > MAX_SESSION_EXERCISES) {
      return NextResponse.json({ error: 'Prea multe exerciții în sesiune.' }, { status: 413 });
    }
    hydratedExercises = await hydrateExercisesWithDbVideos(supabase, exercises);
  }

  if (!hydratedExercises) {
    return NextResponse.json(
      { error: 'Antrenamentul conține exerciții fără video. Generează din nou antrenamentul.' },
      { status: 409 }
    );
  }

  const orderedExercises = orderWorkoutExercises(hydratedExercises);
  const session = {
    focus: resolvedFocus,
    workoutDayIndex: resolvedWorkoutDayIndex,
    exercises: orderedExercises,
    currentIndex: 0,
    xpEarned: 0,
    startedAt: new Date().toISOString(),
  };

  await supabase.from('users').update({ active_workout_session: session }).eq('id', auth.userId);
  await logActivity({
    action: 'workout_session.started',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: {
      focus: resolvedFocus,
      workoutDayIndex: resolvedWorkoutDayIndex,
      generated: generate === true,
      exerciseCount: orderedExercises.length,
    },
  });
  return NextResponse.json({ ok: true, session });
}

/**
 * PATCH /api/user/workout-session
 * Body: { currentIndex, xpEarned }
 * Updates progress of the active session (called after each exercise done).
 */
export async function PATCH(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'user' && auth.role !== 'client') return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-workout-session-progress',
    maxRequests: 180,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  if (requestBodyTooLarge(request, MAX_PATCH_PAYLOAD_BYTES)) {
    return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
  }

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Body invalid.' }, { status: 400 }); }
  const { currentIndex, xpEarned, elapsedSeconds } = body;

  const supabase = getSupabase();
  const { data } = await supabase
    .from('users')
    .select('active_workout_session')
    .eq('id', auth.userId)
    .maybeSingle();

  if (!data?.active_workout_session) {
    return NextResponse.json({ ok: false, error: 'Nicio sesiune activă.' }, { status: 404 });
  }

  const activeSession = data.active_workout_session;
  const exerciseCount = Array.isArray(activeSession.exercises) ? activeSession.exercises.length : MAX_SESSION_EXERCISES;
  const updated = {
    ...activeSession,
    currentIndex: currentIndex === undefined
      ? activeSession.currentIndex
      : clampNumber(currentIndex, 0, exerciseCount, activeSession.currentIndex || 0),
    xpEarned: xpEarned === undefined
      ? activeSession.xpEarned
      : clampNumber(xpEarned, 0, 10000, activeSession.xpEarned || 0),
    ...(elapsedSeconds !== undefined
      ? { elapsedSeconds: clampNumber(elapsedSeconds, 0, 24 * 60 * 60, activeSession.elapsedSeconds || 0) }
      : {}),
  };
  await supabase.from('users').update({ active_workout_session: updated }).eq('id', auth.userId);
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/user/workout-session
 * Clears the active session (on finalize or abandon).
 */
export async function DELETE(request) {
  const { ip, userAgent } = getRequestMeta(request);
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'user' && auth.role !== 'client') return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-workout-session-delete',
    maxRequests: 30,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  const supabase = getSupabase();
  await supabase.from('users').update({ active_workout_session: null }).eq('id', auth.userId);
  await logActivity({
    action: 'workout_session.cleared',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
  });
  return NextResponse.json({ ok: true });
}
