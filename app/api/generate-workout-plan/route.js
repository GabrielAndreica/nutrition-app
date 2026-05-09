import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getSupabase, supabaseQuery } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { sanitizeName, sanitizeText, sanitizeNumber } from '@/app/lib/sanitize';
import { checkRateLimit, requestQueue, generateRequestId } from '@/app/lib/rateLimiter';
import { checkSubscription } from '@/app/lib/checkSubscription';
import { reserveMonthlyClientUsage } from '@/app/lib/clientUsage';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ALLOWED_SPLITS = new Set(['Full Body', 'Push/Pull/Legs', 'Upper/Lower', 'Bro Split']);
const ALLOWED_LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const ALLOWED_EQUIPMENT = new Set(['no equipment', 'dumbbells only', 'full gym']);
const ALLOWED_GOALS = new Set(['muscle gain', 'weight loss', 'maintenance', 'strength', 'endurance']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPENAI_WORKOUT_TIMEOUT_MS = 90000;
const WORKOUT_AI_MODEL = process.env.OPENAI_WORKOUT_MODEL || 'gpt-4o-mini';
const WORKOUT_MAX_TOKENS = 2500;
const DAY_SCHEDULES = {
  2: ['Luni', 'Vineri'],
  3: ['Luni', 'Miercuri', 'Vineri'],
  4: ['Luni', 'Marți', 'Joi', 'Vineri'],
  5: ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri'],
};

const EXERCISE_EQUIPMENT_BY_PROFILE = {
  'no equipment': new Set(['bodyweight']),
  'dumbbells only': new Set(['dumbbell', 'bodyweight']),
  'full gym': null,
};

const WEEKLY_GROUP_TARGET_BASE = {
  'Full Body': {
    baseWorkouts: 3,
    targets: {
      chest: [2, 3],
      back: [3, 4],
      shoulders: [2, 3],
      biceps: [1, 2],
      triceps: [1, 2],
      quads: [2, 3],
      posterior: [2, 3],
      calves: [1, 3],
      abs: [1, 3],
    },
  },
  'Upper/Lower': {
    baseWorkouts: 4,
    targets: {
      chest: [2, 3],
      back: [3, 4],
      shoulders: [2, 3],
      biceps: [2, 3],
      triceps: [2, 3],
      quads: [2, 3],
      posterior: [2, 3],
      calves: [2, 4],
      abs: [2, 4],
    },
  },
  'Push/Pull/Legs': {
    baseWorkouts: 5,
    fixedForFiveOrMore: true,
    targets: {
      chest: [3, 4],
      back: [4, 5],
      shoulders: [3, 4],
      biceps: [2, 4],
      triceps: [2, 4],
      quads: [3, 4],
      posterior: [3, 4],
      calves: [2, 4],
      abs: [2, 4],
    },
  },
  'Bro Split': {
    baseWorkouts: 5,
    targets: {
      chest: [3, 5],
      back: [4, 6],
      shoulders: [3, 5],
      biceps: [3, 4],
      triceps: [3, 4],
      quads: [3, 5],
      posterior: [3, 5],
      calves: [3, 5],
      abs: [2, 5],
    },
  },
};

function normalizeTextKey(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function mapExerciseEquipmentLabel(eq) {
  const value = normalizeTextKey(eq);
  if (value === 'barbell') return 'bară';
  if (value === 'dumbbell') return 'gantere';
  if (value === 'cable') return 'cablu';
  if (value === 'machine') return 'aparat';
  if (value === 'bodyweight') return 'greutatea corpului';
  if (value === 'smith') return 'smith';
  if (value === 'ez_bar') return 'bară EZ';
  if (value === 'trap_bar') return 'trap bar';
  if (value === 'kettlebell') return 'kettlebell';
  return String(eq || '');
}
function withTimeout(promise, ms, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(message);
      err.name = 'TimeoutError';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function readWorkoutDays(v) {
  try {
    return sanitizeNumber(v, { min: 2, max: 5, allowFloat: false });
  } catch {
    return null;
  }
}

const mapActivityToWorkoutDays = (activityLevel) => ({
  sedentary: 2,
  light: 2,
  lightly_active: 2,
  moderate: 4,
  moderately_active: 4,
  active: 5,
  very_active: 5,
  extra_active: 5,
}[activityLevel] || 4);

function resolveWorkoutDays(ownedClient, body) {
  if (ownedClient) {
    return (
      readWorkoutDays(ownedClient.workouts_per_week) ||
      readWorkoutDays(body?.workoutsPerWeek) ||
      mapActivityToWorkoutDays(ownedClient.activity_level) ||
      3
    );
  }

  return readWorkoutDays(body?.workoutsPerWeek) || 3;
}

function normalizeGoal(goal) {
  const g = String(goal || '').toLowerCase().trim();
  if (g === 'weight_loss') return 'weight loss';
  if (g === 'muscle_gain') return 'muscle gain';
  if (!g) return 'muscle gain';
  return g;
}

function normalizeTrainingSplit(split) {
  const raw = String(split || '')
    .replace(/&#x2f;|&#47;/gi, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .trim();
  const value = normalizeTextKey(raw);
  if (!value) return 'Full Body';
  const compact = value.replace(/[\s_\-/]+/g, '');

  if (
    ['full body', 'fullbody', 'full-body', 'corp complet', 'tot corpul', 'total body', 'totalbody'].includes(value)
    || compact === 'fullbody'
    || compact === 'corpcomplet'
    || compact === 'totcorpul'
  ) return 'Full Body';

  if (
    ['push/pull/legs', 'push pull legs', 'push-pull-legs', 'push_pull_legs', 'ppl'].includes(value)
    || compact === 'pushpulllegs'
    || compact === 'ppl'
  ) return 'Push/Pull/Legs';

  if (
    ['upper/lower', 'upper lower', 'upper-lower', 'upper_lower'].includes(value)
    || compact === 'upperlower'
  ) return 'Upper/Lower';

  if (
    ['bro split', 'bro-split', 'bro_split', 'brosplit'].includes(value)
    || compact === 'brosplit'
  ) return 'Bro Split';

  return raw;
}

function resolveAllowedTrainingSplit(raw) {
  const trimmedRaw = String(raw || '').trim();
  if (!trimmedRaw) return null;
  const normalized = normalizeTrainingSplit(trimmedRaw);
  if (!ALLOWED_SPLITS.has(normalized)) return null;
  return normalized;
}

function safeEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function getVolumeTargets(level, goal, split) {
  const levelBase = {
    beginner: { minExercises: 4, maxExercises: 7, minSetsPerExercise: 2, maxSetsPerExercise: 4, minDuration: 40, maxDuration: 75, minTotalSets: 12 },
    intermediate: { minExercises: 4, maxExercises: 8, minSetsPerExercise: 3, maxSetsPerExercise: 5, minDuration: 45, maxDuration: 90, minTotalSets: 14 },
    advanced: { minExercises: 4, maxExercises: 9, minSetsPerExercise: 3, maxSetsPerExercise: 6, minDuration: 45, maxDuration: 110, minTotalSets: 16 },
  }[level] || { minExercises: 4, maxExercises: 8, minSetsPerExercise: 2, maxSetsPerExercise: 5, minDuration: 45, maxDuration: 90, minTotalSets: 14 };

  const adjusted = { ...levelBase };

  if (split === 'Full Body') {
    // Full Body antrenează mai multe grupe => minim mai mare
    adjusted.minExercises = Math.max(adjusted.minExercises, 5);
    adjusted.maxExercises = Math.max(adjusted.maxExercises, 8);
    adjusted.minTotalSets = Math.max(adjusted.minTotalSets, 16);
  }
  // PPL / Upper-Lower / Bro Split: numărul variază natural per sesiune
  // (ziua de picioare poate avea 7, ziua de biceps+triceps poate avea 4-5)
  if (goal === 'strength') {
    adjusted.minSetsPerExercise = Math.max(adjusted.minSetsPerExercise, 3);
    adjusted.minTotalSets = Math.max(adjusted.minTotalSets, 18);
  }
  if (goal === 'muscle gain') {
    adjusted.minSetsPerExercise = Math.max(adjusted.minSetsPerExercise, 3);
    const muscleGainFloorByLevel = { beginner: 15, intermediate: 17, advanced: 19 }[level] || 17;
    adjusted.minTotalSets = Math.max(adjusted.minTotalSets, muscleGainFloorByLevel);
  }
  if (goal === 'weight loss' || goal === 'endurance') {
    adjusted.maxRestSeconds = 120;
  } else {
    adjusted.maxRestSeconds = 240;
  }

  return adjusted;
}

function buildExerciseCatalogMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const keyRo = normalizeTextKey(row?.name_ro);
    const keyEn = normalizeTextKey(row?.name);
    if (keyRo) map.set(keyRo, row);
    if (keyEn) map.set(keyEn, row);
  }
  return map;
}

function buildExerciseCatalogPrompt(rows) {
  const toDisplayName = (row) => String(row?.name_ro || row?.name || '').trim();
  const lines = (rows || []).map((row) => (
    `- ${toDisplayName(row)} | grupă:${row.muscle_group}`
  ));
  return lines.join('\n');
}

function looksLikeExerciseName(name, terms) {
  const n = normalizeTextKey(name);
  return terms.some((t) => n.includes(t));
}

function isTricepsExercise(row) {
  return looksLikeExerciseName(row?.name_ro || row?.name || '', ['triceps', 'pushdown', 'overhead', 'dip', 'skull']);
}

function isBicepsExercise(row) {
  return looksLikeExerciseName(row?.name_ro || row?.name || '', ['biceps', 'curl', 'hammer', 'preacher', 'concentration']);
}

function isBasicExerciseRow(row) {
  const name = normalizeTextKey(`${row?.name_ro || ''} ${row?.name || ''}`);
  if (!name) return false;

  const excludedPatterns = [
    'thruster', 'burpee', 'battle rope', 'sled', 'carry', 'wood chop', 'woodchop',
    'suitcase carry', 'farmer carry', 'erg sprint', 'rowing erg', 'nordic',
    'good morning', 'russian twist', 'frog pump', 'sissy squat',
  ];
  if (excludedPatterns.some((k) => name.includes(k))) return false;

  const includedPatterns = [
    'bench press', 'impins la banca', 'incline', 'decline', 'chest press', 'flotari', 'push-up', 'push up', 'dips',
    'pec deck', 'fly', 'flutur',
    'overhead press', 'presa militara', 'shoulder press', 'lateral raise', 'ridicari laterale', 'front raise', 'rear delt', 'face pull',
    'pull-up', 'pull up', 'chin-up', 'chin up', 'pulldown', 'helcometru', 'row', 'ramat', 't-bar',
    'squat', 'genuflexiuni', 'leg press', 'presa pentru picioare', 'lunge', 'fandari', 'split squat', 'step-up', 'step up',
    'deadlift', 'indreptari', 'romanian deadlift', 'rdl', 'hip thrust', 'glute bridge', 'leg curl', 'flexii femurali', 'leg extension', 'extensii cvadriceps',
    'calf raise', 'ridicari pe varfuri',
    'biceps curl', 'flexii biceps', 'hammer curl', 'preacher',
    'triceps pushdown', 'extensii triceps', 'overhead triceps', 'skull crusher',
    'plank', 'side plank', 'dead bug', 'bird dog', 'hanging leg raise', 'knee raise', 'cable crunch', 'ab wheel', 'pallof',
  ];
  return includedPatterns.some((k) => name.includes(k));
}

function getWeeklyExerciseTargets(split, workoutsPerWeek) {
  const base = WEEKLY_GROUP_TARGET_BASE[split];
  if (!base) return {};
  const fixed = base.fixedForFiveOrMore && workoutsPerWeek >= 5;
  const factor = fixed ? 1 : (workoutsPerWeek / base.baseWorkouts);
  const targets = {};

  for (const [group, [minRaw, maxRaw]] of Object.entries(base.targets)) {
    const min = Math.max(1, Math.round(minRaw * factor));
    const max = Math.max(min, Math.round(maxRaw * factor));
    targets[group] = [min, max];
  }
  return targets;
}

function formatWeeklyTargetsForPrompt(targets) {
  const labels = {
    chest: 'Piept',
    back: 'Spate',
    shoulders: 'Umeri',
    biceps: 'Biceps',
    triceps: 'Triceps',
    quads: 'Cvadricepși',
    posterior: 'Femurali/Fesieri',
    calves: 'Gambe',
    abs: 'Abdomen',
  };
  return Object.entries(targets || {})
    .map(([group, [min, max]]) => `- ${labels[group] || group}: ${min}-${max} exerciții / săptămână`)
    .join('\n');
}

/**
 * Generează secțiunea de echilibru volum și variație exerciții.
 * Previne încărcarea excesivă a unei grupe și exerciții identice cross-sesiune.
 */
function buildVolumeAndVarietySection(trainingSplit, workoutsPerWeek) {
  // Limite per sesiune pentru fiecare grupă (excepție Bro Split unde ziua e dedicată)
  const isBroSplit = trainingSplit === 'Bro Split';

  const perSessionLimits = isBroSplit
    ? `- Bro Split: sesiunea dedicată unei grupe poate avea 4-6 exerciții pentru acea grupă, dar NU include alte grupe decât ca accesorii (max 1-2 exerciții accesorii).`
    : [
        '- Per sesiune, numărul MAXIM de exerciții per grupă musculară:',
        '  • Piept: max 3 exerciții / sesiune',
        '  • Spate: max 3 exerciții / sesiune',
        '  • Umeri: max 2 exerciții / sesiune',
        '  • Biceps: max 2 exerciții / sesiune',
        '  • Triceps: max 2 exerciții / sesiune',
        '  • Cvadricepși: max 3 exerciții / sesiune',
        '  • Femurali/Fesieri: max 3 exerciții / sesiune',
        '  • Gambe: max 2 exerciții / sesiune',
        '  • Abdomen: max 2 exerciții / sesiune',
      ].join('\n');

  // Regula de echilibru — brațele nu trebuie ignorate față de mușchii mari
  const balanceRule = isBroSplit
    ? ''
    : `- ECHILIBRU OBLIGATORIU: Brațele (biceps + triceps total) trebuie să aibă cel puțin 40% din volumul pieptului în aceeași sesiune. Dacă pieptul are 3 exerciții, biceps+triceps trebuie să aibă minim 2 exerciții combinate. NU lăsa 4+ exerciții de piept și 1 exercițiu de brațe.`;

  // Regula de variație cross-sesiune — exerciții diferite pentru aceeași grupă
  const varietyRule = workoutsPerWeek >= 2
    ? [
        '══════════════════════════════════════════',
        'VARIAȚIE OBLIGATORIE INTER-SESIUNI:',
        'Dacă aceeași grupă musculară apare în 2 sau mai multe sesiuni pe săptămână, exercițiile TREBUIE să fie COMPLET DIFERITE în fiecare sesiune.',
        '',
        'EXEMPLE CORECTE:',
        '  ✓ Sesiunea 1 Piept: Împins cu bara la bancă plată → Sesiunea 2 Piept: Împins înclinat cu gantere',
        '  ✓ Sesiunea 1 Spate: Ramat cu bara → Sesiunea 2 Spate: Tracțiuni / Lat pulldown',
        '  ✓ Sesiunea 1 Picioare: Genuflexiuni cu bara → Sesiunea 2 Picioare: Leg press + Fandări',
        '',
        'EXEMPLE INTERZISE:',
        '  ✗ Sesiunea 1: Împins cu bara la bancă plată, Sesiunea 2: Împins cu bara la bancă plată (ACELAȘI exercițiu)',
        '  ✗ Sesiunea 1: Tracțiuni, Sesiunea 2: Tracțiuni (INTERZIS)',
        '',
        'PRINCIPIU: Prima sesiune = compound greu (bară/aparat). A doua sesiune = variație unghi/echipament (gantere, cablu, unghi diferit) SAU izolație.',
        '══════════════════════════════════════════',
      ].join('\n')
    : '';

  return [perSessionLimits, balanceRule, varietyRule].filter(Boolean).join('\n\n');
}

function applyGenderTargetOverrides(targets, gender, split) {
  if (!targets || gender !== 'F') return targets;
  // Femei: prioritate tren inferior (posterior/quads/calves) + abs; redus piept/biceps/triceps
  const adjusted = {};
  for (const [group, [min, max]] of Object.entries(targets)) {
    if (group === 'posterior') {
      adjusted[group] = [Math.max(min, min + 1), Math.max(max, max + 2)];
    } else if (group === 'quads') {
      adjusted[group] = [Math.max(min, min + 1), Math.max(max, max + 1)];
    } else if (group === 'calves') {
      adjusted[group] = [Math.max(min, min + 1), Math.max(max, max + 1)];
    } else if (group === 'abs') {
      adjusted[group] = [Math.max(min, min + 1), Math.max(max, max + 1)];
    } else if (group === 'chest') {
      adjusted[group] = [Math.max(1, min - 1), Math.max(1, max - 1)];
    } else if (group === 'biceps' || group === 'triceps') {
      adjusted[group] = [Math.max(1, min - 1), Math.max(1, max - 1)];
    } else {
      adjusted[group] = [min, max];
    }
  }
  return adjusted;
}

function buildGenderRuleSection(gender, trainingSplit) {
  if (gender === 'F') {
    const lowerFocus = [
      '- GEN: CLIENT FEMEIE — prioritate MAXIMĂ tren inferior în fiecare sesiune posibilă.',
      '- Fesieri (hip thrust, glute bridge, kickback) și femurali (RDL, leg curl) — OBLIGATORIU în orice sesiune de picioare sau Full Body.',
      '- Cvadriceps: squat, leg press, split squat — volum ridicat.',
      '- Gambe: include întotdeauna cel puțin un exercițiu de gambe per sesiune de picioare.',
      '- Abdomen: planșă, dead bug, bird dog — prioritizate față de exerciții dinamice cu impact.',
      '- Piept și brațe: volum REDUS — 1-2 exerciții per sesiune relevantă, fără să domine programul.',
      '- Evită exerciții de piept ca exerciții principale/primare — folosește-le ca accesorii.',
    ];
    if (trainingSplit === 'Push/Pull/Legs' || trainingSplit === 'Upper/Lower') {
      lowerFocus.push('- Sesiunile de picioare (Legs/Lower): minim 4 exerciții pentru tren inferior, fără exerciții de brațe izolate.');
    }
    if (trainingSplit === 'Full Body') {
      lowerFocus.push('- Full Body: începe mereu cu tren inferior (squat/hip thrust/RDL), apoi umeri/spate, piept ultimul.');
    }
    return lowerFocus.join('\n');
  }
  // Bărbat
  return [
    '- GEN: CLIENT BĂRBAT — prioritate PIEPT, UMERI, SPATE și BRAȚE în sesiunile de trenul superior.',
    '- Compuși de piept (bench press variații) și spate (row, pull-up) — obligatoriu ca exerciții principale.',
    '- Brațe (biceps + triceps): include dedicat cel puțin 1-2 exerciții izolate per sesiune relevantă.',
    '- Tren inferior: picioare complet lucrate, dar nu domină față de trenul superior ca volum total.',
  ].join('\n');
}

function getCanonicalGroupFromExercise(rowOrName, muscleGroupText = '') {
  const rowName = typeof rowOrName === 'object'
    ? `${rowOrName?.name_ro || ''} ${rowOrName?.name || ''}`
    : String(rowOrName || '');
  const name = normalizeTextKey(rowName);
  const group = normalizeTextKey(typeof rowOrName === 'object' ? rowOrName?.muscle_group : muscleGroupText);

  if (group === 'chest' || /piept|bench|chest press|fly|flutur/.test(name)) return 'chest';
  if (group === 'back' || /spate|row|ramat|pull|pulldown|tractiuni|tracțiuni/.test(name)) return 'back';
  if (group === 'shoulders' || /umeri|deltoid|shoulder press|lateral raise|rear delt|face pull/.test(name)) return 'shoulders';
  if ((group === 'arms' && isBicepsExercise({ name: rowName })) || /biceps|curl|hammer/.test(name)) return 'biceps';
  if ((group === 'arms' && isTricepsExercise({ name: rowName })) || /triceps|pushdown|skull|extensii triceps|dip/.test(name)) return 'triceps';
  if (group === 'quads' || /cvadriceps|quad|squat|genuflexiuni|leg press|presa pentru picioare|lunge|fandari|step-up|step up|leg extension/.test(name)) return 'quads';
  if (group === 'hamstrings' || group === 'glutes' || /femurali|glute|hip thrust|rdl|romanian deadlift|deadlift|indreptari|leg curl/.test(name)) return 'posterior';
  if (group === 'calves' || /gambe|calf raise|ridicari pe varfuri/.test(name)) return 'calves';
  if (group === 'core' || /abd|core|plank|dead bug|bird dog|crunch|leg raise|pallof/.test(name)) return 'abs';
  return null;
}

function matchesFocus(row, focus) {
  const group = normalizeTextKey(row?.muscle_group);
  const pattern = normalizeTextKey(row?.movement_pattern);
  if (!focus || focus === 'fullBody') return true;
  if (focus === 'push') {
    if (group === 'chest') return true;
    if (group === 'shoulders' && (pattern === 'push' || pattern === 'isolation')) return true;
    if (group === 'arms' && isTricepsExercise(row)) return true;
    if (group === 'core') return true;
    return false;
  }
  if (focus === 'pull') {
    if (group === 'back') return true;
    if (group === 'shoulders' && (pattern === 'pull' || looksLikeExerciseName(row?.name_ro || row?.name || '', ['rear delt', 'face pull', 'reverse']))) return true;
    if (group === 'arms' && isBicepsExercise(row)) return true;
    if (group === 'core') return true;
    return false;
  }
  if (focus === 'legs') {
    return ['legs', 'quads', 'hamstrings', 'glutes', 'calves', 'core'].includes(group);
  }
  if (focus === 'upper') {
    return ['chest', 'back', 'shoulders', 'arms', 'core'].includes(group);
  }
  return true;
}

function buildDayScopedExerciseCatalog(input, rows) {
  const focuses = getSessionFocuses(input.trainingSplit, input.workoutsPerWeek);
  const dayNames = DAY_SCHEDULES[input.workoutsPerWeek] || DAY_SCHEDULES[3];
  const promptSections = [];
  const allowedByDay = new Map();
  const DAY_CATALOG_LIMIT = 22;

  for (let i = 0; i < input.workoutsPerWeek; i += 1) {
    const focus = focuses[i] || 'fullBody';
    const dayRowsRaw = (rows || []).filter((r) => matchesFocus(r, focus));
    const dayRows = (dayRowsRaw.length > 0 ? dayRowsRaw : rows).slice(0, DAY_CATALOG_LIMIT);
    const names = [];
    const allowedSet = new Set();

    for (const row of dayRows) {
      const roName = String(row?.name_ro || '').trim();
      const enName = String(row?.name || '').trim();
      const displayName = roName || enName;
      if (!displayName) continue;
      names.push(displayName);
      allowedSet.add(normalizeTextKey(displayName));
      if (enName) allowedSet.add(normalizeTextKey(enName));
      if (roName) allowedSet.add(normalizeTextKey(roName));
    }

    allowedByDay.set(i + 1, allowedSet);
    promptSections.push(
      `Ziua ${i + 1} (${dayNames[i] || `Ziua ${i + 1}`}, focus ${focus}):\n${names.map((n) => `- ${n}`).join('\n')}`
    );
  }

  return {
    promptText: promptSections.join('\n\n'),
    allowedByDay,
  };
}

function mapMuscleGroupLabel(group) {
  const key = normalizeTextKey(group);
  const labels = {
    chest: 'Piept',
    back: 'Spate',
    shoulders: 'Umeri',
    legs: 'Picioare',
    glutes: 'Fesieri',
    hamstrings: 'Femurali',
    quads: 'Cvadriceps',
    calves: 'Gambe',
    arms: 'Brațe',
    core: 'Core',
    full_body: 'Tot corpul',
  };
  return labels[key] || String(group || '').trim() || 'Nespecificat';
}

function parseSetRange(value, fallbackMin = 3, fallbackMax = 4) {
  const raw = String(value || '').trim();
  const m = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) {
    const min = Math.max(1, Number(m[1]));
    const max = Math.max(min, Number(m[2]));
    return { min, max };
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return { min: Math.floor(n), max: Math.floor(n) };
  return { min: fallbackMin, max: fallbackMax };
}

function getLocalExercisePrescription({ input, volume, catalogItem, exerciseIndex }) {
  const level = input.fitnessLevel;
  const goal = input.fitnessGoal;
  const isCompound = catalogItem?.is_compound !== false;
  const baseRange = parseSetRange(catalogItem?.default_sets, isCompound ? 3 : 2, isCompound ? 4 : 3);
  let sets = level === 'advanced' ? baseRange.max : (level === 'beginner' ? baseRange.min : Math.round((baseRange.min + baseRange.max) / 2));

  if (goal === 'strength') sets = Math.max(sets, isCompound ? 4 : 3);
  if (goal === 'muscle gain') sets = Math.max(sets, isCompound ? 3 : 2);
  if (goal === 'weight loss' || goal === 'endurance') sets = Math.max(sets - 1, isCompound ? 2 : 2);
  if (exerciseIndex === 0 && (goal === 'strength' || goal === 'muscle gain')) sets = Math.min(sets + 1, volume.maxSetsPerExercise + 1);
  sets = Math.max(volume.minSetsPerExercise, Math.min(volume.maxSetsPerExercise + 1, sets));

  let reps = String(catalogItem?.default_reps || '').trim() || '8-12';
  let restSeconds = Number(catalogItem?.default_rest_seconds) || 90;
  if (goal === 'strength') {
    reps = isCompound ? '4-6' : '8-12';
    restSeconds = isCompound ? 150 : 90;
  } else if (goal === 'muscle gain') {
    reps = isCompound ? '6-10' : '10-15';
    restSeconds = isCompound ? 105 : 75;
  } else if (goal === 'weight loss') {
    reps = isCompound ? '8-12' : '12-15';
    restSeconds = isCompound ? 75 : 45;
  } else if (goal === 'endurance') {
    reps = isCompound ? '12-15' : '15-20';
    restSeconds = isCompound ? 60 : 45;
  } else {
    reps = isCompound ? '6-10' : '10-15';
    restSeconds = isCompound ? 90 : 60;
  }
  restSeconds = Math.max(30, Math.min(volume.maxRestSeconds + 60, restSeconds));

  return {
    sets,
    reps,
    restSeconds,
    instructions: 'Mișcare controlată, amplitudine completă.',
    commonMistakes: 'Evită impulsul și postura instabilă.',
  };
}

function rebalanceDayVolume(day, volume) {
  let totalSets = (day.exercises || []).reduce((sum, ex) => sum + (Number(ex.sets) || 0), 0);
  if (totalSets >= volume.minTotalSets) return;
  let guard = 0;
  while (totalSets < volume.minTotalSets && guard < 100) {
    guard += 1;
    for (const ex of day.exercises || []) {
      if (totalSets >= volume.minTotalSets) break;
      const maxSets = volume.maxSetsPerExercise + 1;
      if ((ex.sets || 0) < maxSets) {
        ex.sets += 1;
        totalSets += 1;
      }
    }
  }
}

function normalizeGeneratedPlan(rawPlan, input, exerciseCatalogMap = null) {
  const rawDays = Array.isArray(rawPlan?.days)
    ? rawPlan.days
    : (Array.isArray(rawPlan?.sessions) ? rawPlan.sessions : []);
  const targetWorkoutDays = input.workoutsPerWeek;
  const scheduledNames = DAY_SCHEDULES[targetWorkoutDays] || DAY_SCHEDULES[3];
  const focuses = getSessionFocuses(input.trainingSplit, targetWorkoutDays);
  const buildWarmup = (focus) => {
    if (focus === 'push') return '5-7 min cardio ușor + mobilitate umeri/coate + 2 seturi progresive la împins.';
    if (focus === 'pull') return '5-7 min cardio ușor + mobilitate scapule/spate + 2 seturi progresive la tracțiune/ramat.';
    if (focus === 'legs') return '6-8 min cardio ușor + mobilitate șold/gleznă + 2 seturi progresive la genuflexiuni.';
    if (focus === 'upper') return '5-7 min cardio + mobilitate umeri/spate + seturi progresive la primul compus.';
    return '5-7 min cardio ușor + mobilitate generală + 2 seturi progresive la primul exercițiu.';
  };
  const buildCooldown = (focus) => {
    if (focus === 'push') return '4-6 min respirație controlată + stretching piept/umeri/triceps.';
    if (focus === 'pull') return '4-6 min respirație controlată + stretching spate/biceps.';
    if (focus === 'legs') return '4-6 min mers ușor + stretching cvadriceps/femurali/fesieri.';
    if (focus === 'upper') return '4-6 min respirație + stretching partea superioară.';
    return '4-6 min mers ușor + stretching pentru grupele lucrate.';
  };
  const volume = getVolumeTargets(input.fitnessLevel, input.fitnessGoal, input.trainingSplit);
  const normalizedDays = rawDays.slice(0, targetWorkoutDays).map((day, idx) => {
    const focus = focuses[idx] || '';
    const exercises = Array.isArray(day?.exercises)
      ? day.exercises
      : (Array.isArray(day) ? day : []);
    const normalizedExercises = exercises.slice(0, 8).map((ex, exIdx) => {
      const exName = typeof ex === 'string' ? String(ex).trim() : String(ex?.name || '').trim();
      const catalogItem = exerciseCatalogMap?.get(normalizeTextKey(exName)) || null;
      const prescription = getLocalExercisePrescription({ input, volume, catalogItem, exerciseIndex: exIdx });
      const finalName = String(catalogItem?.name_ro || catalogItem?.name || exName).trim();
      return {
        order: exIdx + 1,
        name: finalName,
        muscleGroup: mapMuscleGroupLabel(catalogItem?.muscle_group || (typeof ex === 'object' ? ex?.muscleGroup : '')),
        sets: prescription.sets,
        reps: prescription.reps,
        restSeconds: prescription.restSeconds,
        instructions: prescription.instructions,
        commonMistakes: prescription.commonMistakes,
      };
    }).filter(ex => ex.name);

    const fallbackDuration = 20 + normalizedExercises.length * 7;
    const normalizedDay = {
      day: idx + 1,
      dayName: String(day?.dayName || '').trim() || scheduledNames[idx] || `Ziua ${idx + 1}`,
      isRestDay: false,
      sessionName: getSessionName(input.trainingSplit, focus, idx),
      estimatedDuration: Math.max(25, Math.min(180, Number(day?.estimatedDuration) || fallbackDuration)),
      warmup: String(day?.warmup || '').trim() || buildWarmup(focus),
      cooldown: String(day?.cooldown || '').trim() || buildCooldown(focus),
      exercises: normalizedExercises,
    };
    rebalanceDayVolume(normalizedDay, volume);

    return normalizedDay;
  });

  return {
    clientName: input.name,
    split: input.trainingSplit,
    fitnessLevel: input.fitnessLevel,
    fitnessGoal: input.fitnessGoal,
    workoutsPerWeek: input.workoutsPerWeek,
    days: normalizedDays,
  };
}

function ensureWorkoutDayCount(plan, input) {
  const targetWorkoutDays = input.workoutsPerWeek;
  const fallbackPlan = buildFallbackWorkoutPlan(input);
  const existingDays = Array.isArray(plan?.days) ? plan.days.slice(0, targetWorkoutDays) : [];
  const days = existingDays.length > 0 ? existingDays : [];

  while (days.length < targetWorkoutDays) {
    const fallbackDay = fallbackPlan.days[days.length];
    if (!fallbackDay) break;
    days.push(fallbackDay);
  }

  return {
    ...fallbackPlan,
    ...(plan || {}),
    workoutsPerWeek: targetWorkoutDays,
    days: days.map((day, idx) => ({
      ...day,
      day: idx + 1,
      dayName: day.dayName || fallbackPlan.days[idx]?.dayName || `Ziua ${idx + 1}`,
    })),
  };
}

function parseWorkoutJson(content) {
  const raw = String(content || '').trim();
  if (!raw) throw new Error('Răspuns AI gol.');
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }
    throw new Error(`JSON invalid de la AI (primele 200 caractere): ${cleaned.slice(0, 200)}`);
  }
}

function getInjuryRiskKeywords(text) {
  const s = String(text || '').toLowerCase();
  return {
    shoulder: /(umar|shoulder|rotator|impingement|labrum|acromio|supraspinos|coafa)/.test(s),
    knee: /(genunchi|knee|menisc|lca|acl|patel|patella|ligament)/.test(s),
    lowBack: /(lombar|spate|back|hernie|disc|sciatic|sciatica)/.test(s),
    wristElbow: /(incheiet|wrist|cot|elbow|tendonit|epicondilit)/.test(s),
    ankle: /(glezna|ankle|achile|achilles)/.test(s),
  };
}

function validateWeeklyExerciseTargets(plan, targets, exerciseCatalogMap) {
  if (!targets || Object.keys(targets).length === 0) return;
  const counts = Object.fromEntries(Object.keys(targets).map((k) => [k, 0]));

  for (const day of plan?.days || []) {
    for (const ex of day?.exercises || []) {
      const exName = String(ex?.name || '').trim();
      const row = exerciseCatalogMap?.get(normalizeTextKey(exName)) || null;
      const group = getCanonicalGroupFromExercise(row || exName, row?.muscle_group || ex?.muscleGroup || '');
      if (group && Object.prototype.hasOwnProperty.call(counts, group)) {
        counts[group] += 1;
      }
    }
  }

  const labels = {
    chest: 'Piept',
    back: 'Spate',
    shoulders: 'Umeri',
    biceps: 'Biceps',
    triceps: 'Triceps',
    quads: 'Cvadricepși',
    posterior: 'Femurali/Fesieri',
    calves: 'Gambe',
    abs: 'Abdomen',
  };

  for (const [group, [min, max]] of Object.entries(targets)) {
    const count = counts[group] || 0;
    if (count < min || count > max) {
      throw new Error(`${labels[group] || group}: ${count} exerciții/săptămână (țintă ${min}-${max}).`);
    }
  }
}

function validatePlan(plan, input, exerciseCatalogMap = null, dayAllowedExercises = null, weeklyTargets = null) {
  const workoutsPerWeek = input.workoutsPerWeek;
  if (!Array.isArray(plan?.days) || plan.days.length !== workoutsPerWeek) {
    throw new Error(`Planul trebuie să aibă exact ${workoutsPerWeek} sesiuni.`);
  }

  const volume = getVolumeTargets(input.fitnessLevel, input.fitnessGoal, input.trainingSplit);
  const injuryFlags = getInjuryRiskKeywords(input.injuriesLimitations);
  const forbiddenPatterns = [];
  if (injuryFlags.shoulder) forbiddenPatterns.push(/upright row|behind the neck|military press|overhead press/i);
  if (injuryFlags.knee) forbiddenPatterns.push(/jump squat|pistol squat|box jump/i);
  if (injuryFlags.lowBack) forbiddenPatterns.push(/good morning|conventional deadlift|barbell row/i);
  if (injuryFlags.wristElbow) forbiddenPatterns.push(/skull crusher|straight bar curl/i);
  if (injuryFlags.ankle) forbiddenPatterns.push(/box jump|burpee jump|sprint/i);

  for (const d of plan.days) {
    if (d.isRestDay) {
      throw new Error('Planul nu trebuie să conțină zile de odihnă în lista de sesiuni.');
    }
    if (!Array.isArray(d.exercises) || d.exercises.length < 4) {
      throw new Error(`Ziua ${d.day} are prea puține exerciții. Minim: 4.`);
    }
    if (d.exercises.length > volume.maxExercises + 2) {
      throw new Error(`Ziua ${d.day} are prea multe exerciții.`);
    }
    if (!d.warmup || !d.cooldown) {
      throw new Error(`Ziua ${d.day} trebuie să includă încălzire și cooldown.`);
    }
    if (input.trainingSplit !== 'Full Body') {
      const focus = getSessionFocuses(input.trainingSplit, workoutsPerWeek)[d.day - 1] || '';
      const sessionText = `${d.sessionName || ''} ${(d.exercises || []).map(ex => `${ex.name} ${ex.muscleGroup}`).join(' ')}`.toLowerCase();
      if (/full\s*body|total\s*body|tot corpul|corp complet/i.test(d.sessionName || '')) {
        throw new Error(`Ziua ${d.day} este Full Body, dar splitul selectat este ${input.trainingSplit}.`);
      }
      const focusPatterns = {
        push: /(push|piept|umeri|triceps|împins|impins|fluturări|fluturari)/i,
        pull: /(pull|spate|biceps|ramat|tracțiuni|tractiuni|pulldown|face pull)/i,
        legs: /(legs|lower|picioare|cvadriceps|fesieri|femurali|gambe|genuflexiuni|presă|presa)/i,
        upper: /(upper|partea superioară|partea superioara|piept|spate|umeri|biceps|triceps)/i,
      };
      if (focusPatterns[focus] && !focusPatterns[focus].test(sessionText)) {
        throw new Error(`Ziua ${d.day} nu respectă focusul ${focus} pentru splitul ${input.trainingSplit}.`);
      }
    }

    const seen = new Set();
    let daySets = 0;
    for (const ex of d.exercises) {
      const exName = String(ex.name || '').trim();
      const key = exName.toLowerCase();
      if (!exName) throw new Error(`Ziua ${d.day} conține exerciții fără nume.`);
      if (seen.has(key)) throw new Error(`Ziua ${d.day} conține exerciții duplicate: ${exName}`);
      seen.add(key);

      if (exerciseCatalogMap && exerciseCatalogMap.size > 0) {
        const catalogItem = exerciseCatalogMap.get(normalizeTextKey(exName));
        if (!catalogItem) {
          throw new Error(`Ziua ${d.day}: exercițiul "${exName}" nu există în tabela exercises.`);
        }
        ex.name = String(catalogItem.name_ro || catalogItem.name || exName).trim();
      }
      // dayAllowedExercises check removed — catalog per zi e limitat la 22 exerciții
      // și poate exclude exerciții valide; validarea se face la nivel de catalog global.

      if (ex.sets < volume.minSetsPerExercise || ex.sets > volume.maxSetsPerExercise + 1) {
        throw new Error(`Ziua ${d.day}: ${exName} are seturi în afara intervalului optim.`);
      }
      if (!String(ex.reps || '').trim()) {
        throw new Error(`Ziua ${d.day}: ${exName} nu are repetări.`);
      }
      if (ex.restSeconds > volume.maxRestSeconds + 60) {
        throw new Error(`Ziua ${d.day}: ${exName} are pauză prea mare pentru obiectiv.`);
      }
      if (!ex.instructions || !ex.commonMistakes) {
        throw new Error(`Ziua ${d.day}: ${exName} trebuie să includă instrucțiuni și greșeli frecvente.`);
      }

      for (const forbidden of forbiddenPatterns) {
        if (forbidden.test(exName)) {
          throw new Error(`Ziua ${d.day}: ${exName} contravine limitărilor clientului.`);
        }
      }

      daySets += ex.sets;
    }

    if (daySets < volume.minTotalSets) {
      throw new Error(`Ziua ${d.day} are volum prea mic (${daySets} seturi). Minim: ${volume.minTotalSets}.`);
    }
    if (d.estimatedDuration < volume.minDuration || d.estimatedDuration > volume.maxDuration + 20) {
      throw new Error(`Ziua ${d.day} are durată nepotrivită pentru nivel/obiectiv.`);
    }
  }

  // validateWeeklyExerciseTargets removed din validare — țintele săptămânale sunt
  // folosite doar ca ghid în prompt, nu ca validare strictă post-generare.
}

/**
 * Extrage numele tuturor exercițiilor dintr-un plan de antrenament salvat în DB.
 */
function extractExerciseNamesFromPlan(planData) {
  const names = new Set();
  for (const day of planData?.days || []) {
    for (const ex of day?.exercises || []) {
      const n = String(ex?.name || '').trim();
      if (n) names.add(n);
    }
  }
  return Array.from(names);
}

function buildWorkoutPrompt(data, catalogPrompt, weeklyTargets = null, previousExercises = []) {
  const {
    name,
    gender,
    trainingSplit,
    workoutsPerWeek,
    fitnessLevel,
    availableEquipment,
    fitnessGoal,
    injuriesLimitations,
    workoutPreferences,
  } = data;
  const genderSection = buildGenderRuleSection(gender || 'M', trainingSplit);
  const schedule = DAY_SCHEDULES[workoutsPerWeek] || DAY_SCHEDULES[3];
  const volume = getVolumeTargets(fitnessLevel, fitnessGoal, trainingSplit);
  const splitStructure = trainingSplit === 'Push/Pull/Legs' && workoutsPerWeek === 4
    ? '- STRUCTURĂ PPL 4 ZILE: Push, Pull, Legs, Upper/Push-Pull accesorii. Nu inventa 7 zile și nu repeta Legs imediat.'
    : trainingSplit === 'Push/Pull/Legs' && workoutsPerWeek === 5
      ? '- STRUCTURĂ PPL 5 ZILE OBLIGATORIU: Ziua 1 Push, Ziua 2 Pull, Ziua 3 Legs, Ziua 4 Push, Ziua 5 Pull. INTERZIS Full Body.'
    : trainingSplit === 'Push/Pull/Legs'
      ? `- STRUCTURĂ PPL: folosește exact ${workoutsPerWeek} sesiuni în rotație Push/Pull/Legs.`
      : `- STRUCTURĂ SPLIT: folosește exact splitul "${trainingSplit}" pe ${workoutsPerWeek} sesiuni.`;

  const levelRules = {
    beginner: `- Nivel ÎNCEPĂTOR: tehnică strictă, RPE 6-8, 2-4 seturi/exercițiu, fără tehnici avansate.`,
    intermediate: `- Nivel INTERMEDIAR: volum moderat-ridicat, RPE 7-9, 3-5 seturi/exercițiu.`,
    advanced: `- Nivel AVANSAT: volum ridicat controlat, 3-6 seturi/exercițiu, progresie clară.`,
  }[fitnessLevel] || '';

  const equipmentRules = {
    'no equipment': `- ECHIPAMENT: doar greutatea corpului. Fără recomandări care necesită aparate/sală.`,
    'dumbbells only': `- ECHIPAMENT: doar gantere + greutatea corpului.`,
    'full gym': `- ECHIPAMENT: sală completă.`,
  }[availableEquipment] || '';

  const goalRules = {
    'muscle gain': `- OBIECTIV: Hipertrofie — seturi de lucru suficiente, 6-15 reps, progresie de volum/încărcare.`,
    'weight loss': `- OBIECTIV: Slăbire — păstrează masa musculară, densitate mai mare, superserii inteligente când e sigur.`,
    'maintenance': `- OBIECTIV: Menținere — volum moderat, calitate tehnică, recuperare bună.`,
    'strength': `- OBIECTIV: Forță — exerciții de bază prioritare, reps joase-moderate la principale, accesorii pentru echilibru.`,
    'endurance': `- OBIECTIV: Rezistență — reps mai mari, pauze mai scurte, control al tehnicii.`,
  }[fitnessGoal] || '';

  const injurySection = injuriesLimitations
    ? `\nRESTRICȚII MEDICALE OBLIGATORII (NU LE IGNORA):\n"${injuriesLimitations}"\nEvita orice exercițiu care agravează aceste zone. Oferă alternative sigure.\n`
    : '';

  const prefSection = workoutPreferences
    ? `\nPREFERINȚE CLIENT:\n"${workoutPreferences}"\n`
    : '';
  const weeklyTargetsSection = weeklyTargets && Object.keys(weeklyTargets).length > 0
    ? `\nȚINTE OBLIGATORII exerciții / grupă / săptămână:\n${formatWeeklyTargetsForPrompt(weeklyTargets)}\n`
    : '';
  const previousExercisesSection = previousExercises && previousExercises.length > 0
    ? `\nEXERCIȚII INTERZISE (au fost folosite săptămâna trecută — NU le repeta, alege alternative diferite):\n${previousExercises.map(e => `- ${e}`).join('\n')}\n`
    : '';
  const volumeAndVarietySection = buildVolumeAndVarietySection(trainingSplit, workoutsPerWeek);

  return `Generează un plan de antrenament JSON pentru clientul "${name}".
Tip plan: "${trainingSplit}".
Număr sesiuni pe săptămână: ${workoutsPerWeek}.
Zile: ${schedule.join(', ')}.
${levelRules}
${equipmentRules}
${goalRules}
${splitStructure}
${genderSection}
${weeklyTargetsSection}${previousExercisesSection}${injurySection}${prefSection}

${volumeAndVarietySection}

Reguli:
- Returnează EXACT ${workoutsPerWeek} zile de antrenament.
- Respectă strict split-ul "${trainingSplit}" (nu transforma în Full Body dacă nu e Full Body).
- Numărul de exerciții per zi variază în funcție de grupele musculare ale sesiunii:
  • Sesiuni cu o singură grupă mică (ex: Biceps, Triceps, Gambe): 4-5 exerciții
  • Sesiuni cu o grupă mare + una mică (ex: Piept+Triceps, Spate+Biceps): 5-6 exerciții
  • Sesiuni cu grupe mari (ex: Picioare, Spate, Full Body): 6-${volume.maxExercises} exerciții
- NU adăuga exerciții inutile doar pentru a umple un număr fix.
- Respectă țintele pe grupe musculare de mai sus (număr de exerciții/săptămână).
- Respectă limitele maxime per grupă per sesiune de mai sus.
- Asigură-te că exercițiile pentru aceeași grupă sunt DIFERITE între sesiuni.
- Alege EXCLUSIV exerciții din lista de mai jos (nume exact).
- NU trimite seturi, repetări, pauze, instrucțiuni sau descrieri.

LISTA OFICIALĂ DE EXERCIȚII:
${catalogPrompt}

Răspuns JSON:
{
  "days": [
    { "day": 1, "exercises": ["Nume exact din listă", "Nume exact din listă"] }
  ]
}
Răspunde strict JSON valid.`;
}

/**
 * Prompt specializat pentru regenerarea planului de antrenament după progres client.
 * Include planul anterior, feedback-ul clientului și toate restricțiile.
 */
function buildWorkoutProgressPrompt(data, catalogPrompt, weeklyTargets = null, previousExercises = [], progressData = {}) {
  const { name, trainingSplit, workoutsPerWeek, fitnessLevel, availableEquipment, fitnessGoal, gender } = data;
  const schedule = DAY_SCHEDULES[workoutsPerWeek] || DAY_SCHEDULES[3];

  const levelRules = {
    beginner: 'Nivel: BEGINNER. Săptămâna 2-3 serii / exercițiu, 12-15 repetări, pauze 75-90s. Exerciții simple, tehnică prioritară.',
    intermediate: 'Nivel: INTERMEDIATE. 3-4 serii / exercițiu, 8-12 repetări, pauze 90-120s. Mix compound + izolație.',
    advanced: 'Nivel: ADVANCED. 4-5 serii / exercițiu, 6-12 repetări, pauze 120-180s. Exerciții compound grele + tehnici avansate.',
  }[fitnessLevel] || '';

  const goalRules = {
    'weight loss': 'Scop: SLĂBIT. Prioritizează circuite metabolice, supraset-uri, volum moderat, pauze scurte (45-60s). Include exerciții cardio funcționale.',
    'muscle gain': 'Scop: CREȘTERE MASĂ. Prioritizează exerciții compound grele (genuflexiuni, îndr. rom., împins la bancă). Volum ridicat, progresie de forță.',
    'maintenance': 'Scop: MENȚINERE. Echilibru între forță și condiție fizică, volum moderat, variat.',
  }[fitnessGoal] || '';

  const genderSection = gender === 'F'
    ? '\nGEN: FEMININ. Prioritizează exerciții pentru fesieri și coapse (hip thrust, fandări, glute bridge, etc.). Reduce exerciții pentru trunchiul superior.'
    : '';

  const injurySection = data.injuriesLimitations?.trim()
    ? `\nLIMITĂRI / LEZIUNI (CRITIC — respectă ABSOLUT):\n${data.injuriesLimitations}\nNU include exerciții contraindicate pentru aceste leziuni.`
    : '';

  const prefSection = data.workoutPreferences?.trim()
    ? `\nPREFERINȚE ANTRENAMENT (respectă în limita posibilului):\n${data.workoutPreferences}`
    : '';

  const equipmentRules = {
    'full gym': 'Echipament: SALĂ COMPLETĂ. Aparatură, gantere, helcometru, bare.',
    'dumbbells only': 'Echipament: GANTERE DOAR. Fără aparate și helcometru.',
    'no equipment': 'Echipament: GREUTATEA CORPULUI. Fără gantere sau aparate.',
  }[availableEquipment] || '';

  const splitStructure = {
    'Full Body': 'SPLIT: FULL BODY. Fiecare sesiune lucrează întreg corpul.',
    'Push/Pull/Legs': 'SPLIT: PPL. Sesiuni separate pentru Piept+Umeri+Triceps / Spate+Biceps / Picioare.',
    'Upper/Lower': 'SPLIT: UPPER/LOWER. Alternă Upper Body și Lower Body.',
    'Bro Split': 'SPLIT: BRO SPLIT. Fiecare sesiune — o singură grupă musculară.',
  }[trainingSplit] || '';

  const weeklyTargetsSection = weeklyTargets && Object.keys(weeklyTargets).length > 0
    ? `\nȚINTE OBLIGATORII exerciții / grupă / săptămână:\n${formatWeeklyTargetsForPrompt(weeklyTargets)}\n`
    : '';

  const previousExercisesSection = previousExercises && previousExercises.length > 0
    ? `\nEXERCIȚII INTERZISE (au fost folosite săptămâna trecută — NU le repeta, alege alternative diferite):\n${previousExercises.map(e => `- ${e}`).join('\n')}\n`
    : '';

  const volumeAndVarietySection = buildVolumeAndVarietySection(trainingSplit, workoutsPerWeek);

  // Feedback antrenament
  const adherenceLabels = { great: 'excelent', good: 'bun', ok: 'ok', poor: 'slab' };
  const difficultyLabels = { too_easy: 'prea ușor', perfect: 'perfect', too_hard: 'prea greu' };
  const domsLabels = { none: 'deloc', mild: 'ușoară', strong: 'intensă', extreme: 'extremă' };
  const pumpLabels = { great: 'excelent', good: 'bun', ok: 'ok', poor: 'slab' };
  const fatigueLabels = { low: 'scăzută', normal: 'normală', high: 'ridicată', very_high: 'foarte ridicată' };

  const workoutFeedback = [
    progressData?.workoutAdherence  ? `- Aderență antrenament: ${adherenceLabels[progressData.workoutAdherence] || progressData.workoutAdherence}` : null,
    progressData?.workoutDifficulty ? `- Dificultate percepută: ${difficultyLabels[progressData.workoutDifficulty] || progressData.workoutDifficulty}` : null,
    progressData?.doms               ? `- Dureri musculare (DOMS): ${domsLabels[progressData.doms] || progressData.doms}` : null,
    progressData?.pump               ? `- Pump muscular: ${pumpLabels[progressData.pump] || progressData.pump}` : null,
    progressData?.generalFatigue     ? `- Oboseală generală: ${fatigueLabels[progressData.generalFatigue] || progressData.generalFatigue}` : null,
    progressData?.workoutNotes?.trim() ? `- Observații: "${progressData.workoutNotes.trim()}"` : null,
  ].filter(Boolean).join('\n') || 'Niciun feedback specific.';

  // Adaptează intensitatea la feedback
  let intensityAdaptation = '';
  if (progressData?.workoutDifficulty === 'too_easy') {
    intensityAdaptation = '\n⚠️ ADAPTĂ INTENSITATE: Clientul consideră antrenamentele prea ușoare. Crește dificultatea: exerciții mai complexe, volum mai mare, tehnici avansate.';
  } else if (progressData?.workoutDifficulty === 'too_hard') {
    intensityAdaptation = '\n⚠️ ADAPTĂ INTENSITATE: Clientul consideră antrenamentele prea grele. Reduce dificultatea: exerciții mai accesibile, volum mai mic, pauze mai lungi.';
  }
  if (progressData?.generalFatigue === 'very_high' || progressData?.generalFatigue === 'high') {
    intensityAdaptation += '\n⚠️ OBOSEALĂ RIDICATĂ: Include mai multă muncă de mobilitate/stretching, reduce volumul cu ~20%, mărește pauzele.';
  }
  if (progressData?.doms === 'extreme') {
    intensityAdaptation += '\n⚠️ DOMS EXTREM: Evită suprasolicitarea aceluiași grup muscular. Introduce mai multe zile de recuperare activă.';
  }

  return `Actualizează planul de antrenament JSON pentru clientul "${name}" pe baza progresului său.
Tip plan: "${trainingSplit}".
Număr sesiuni pe săptămână: ${workoutsPerWeek}.
Zile: ${schedule.join(', ')}.
${levelRules}
${equipmentRules}
${goalRules}
${splitStructure}
${genderSection}
${weeklyTargetsSection}${previousExercisesSection}${injurySection}${prefSection}

${volumeAndVarietySection}

FEEDBACK ANTRENAMENT (săptămâna trecută — FOLOSEȘTE-L pentru a adapta planul):
${workoutFeedback}
${intensityAdaptation}

Reguli:
- Returnează EXACT ${workoutsPerWeek} zile de antrenament.
- Respectă strict split-ul "${trainingSplit}".
- Adaptează exercițiile la feedback-ul clientului (dificultate, oboseală, DOMS).
- NU repeta exercițiile interzise listate mai sus.
- Respectă limitele maxime per grupă per sesiune din secțiunea de mai sus.
- Asigură-te că exercițiile pentru aceeași grupă sunt DIFERITE între sesiuni.
- Numărul de exerciții per zi:
  • Sesiuni cu o singură grupă mică: 4-5 exerciții
  • Sesiuni cu grupă mare + una mică: 5-6 exerciții
  • Sesiuni cu grupe mari: 6-8 exerciții
- Alege EXCLUSIV exerciții din lista de mai jos (nume exact).
- NU trimite seturi, repetări, pauze, instrucțiuni sau descrieri.

LISTA OFICIALĂ DE EXERCIȚII:
${catalogPrompt}

Răspuns JSON:
{
  "days": [
    { "day": 1, "exercises": ["Nume exact din listă", "Nume exact din listă"] }
  ]
}
Răspunde strict JSON valid.`;
}

const FALLBACK_EXERCISES = {
  'full gym': {
    push: [
      ['Împins la aparat pentru piept', 'Piept', '8-12', 120],
      ['Împins înclinat cu gantere', 'Piept', '8-12', 120],
      ['Presă pentru umeri la aparat', 'Umeri', '10-12', 90],
      ['Fluturări la cablu', 'Piept', '12-15', 75],
      ['Ridicări laterale cu gantere', 'Umeri', '12-15', 60],
      ['Extensii triceps la cablu', 'Triceps', '10-15', 75],
      ['Flotări controlate', 'Piept/Triceps', 'AMRAP tehnic', 60],
      ['Plank', 'Core', '30-45 sec', 45],
    ],
    pull: [
      ['Tracțiuni asistate la aparat', 'Spate', '8-12', 120],
      ['Ramat la aparat cu piept sprijinit', 'Spate', '8-12', 120],
      ['Lat pulldown priză neutră', 'Spate', '10-12', 90],
      ['Face pull la cablu', 'Umeri posteriori', '12-15', 60],
      ['Pullover la cablu', 'Spate', '12-15', 75],
      ['Flexii biceps cu gantere', 'Biceps', '10-12', 75],
      ['Flexii hammer', 'Biceps/Brahial', '10-12', 75],
      ['Dead bug', 'Core', '8-10/parte', 45],
    ],
    legs: [
      ['Presă pentru picioare', 'Cvadriceps/Fesieri', '10-12', 120],
      ['Genuflexiuni goblet', 'Cvadriceps/Fesieri', '8-12', 120],
      ['Hip thrust la aparat', 'Fesieri', '8-12', 120],
      ['Flexii femurali la aparat', 'Femurali', '10-15', 90],
      ['Extensii cvadriceps la aparat', 'Cvadriceps', '10-15', 90],
      ['Fandări inverse cu gantere', 'Picioare', '8-10/parte', 90],
      ['Ridicări pe vârfuri la aparat', 'Gambe', '12-20', 60],
      ['Pallof press la cablu', 'Core', '10-12/parte', 45],
    ],
    upper: [
      ['Împins la aparat pentru piept', 'Piept', '8-12', 120],
      ['Ramat la aparat cu piept sprijinit', 'Spate', '8-12', 120],
      ['Lat pulldown priză neutră', 'Spate', '10-12', 90],
      ['Împins înclinat cu gantere', 'Piept', '10-12', 90],
      ['Ridicări laterale cu gantere', 'Umeri', '12-15', 60],
      ['Face pull la cablu', 'Umeri posteriori', '12-15', 60],
      ['Extensii triceps la cablu', 'Triceps', '10-15', 75],
      ['Flexii biceps cu gantere', 'Biceps', '10-12', 75],
    ],
  },
  'dumbbells only': {
    push: [
      ['Împins cu gantere pe podea', 'Piept', '8-12', 120],
      ['Împins înclinat cu gantere', 'Piept', '8-12', 120],
      ['Flotări controlate', 'Piept/Triceps', 'AMRAP tehnic', 75],
      ['Ridicări laterale cu gantere', 'Umeri', '12-15', 60],
      ['Fluturări cu gantere', 'Piept', '12-15', 75],
      ['Extensii triceps cu gantera', 'Triceps', '10-15', 75],
      ['Împins priză îngustă cu gantere', 'Triceps/Piept', '10-12', 90],
      ['Plank', 'Core', '30-45 sec', 45],
    ],
    pull: [
      ['Ramat cu gantera cu sprijin', 'Spate', '8-12/parte', 120],
      ['Ramat cu gantere cu piept sprijinit', 'Spate', '8-12', 120],
      ['Pullover cu gantera', 'Spate', '10-12', 90],
      ['Reverse fly cu gantere', 'Umeri posteriori', '12-15', 60],
      ['Shrug cu gantere', 'Trapez', '10-15', 75],
      ['Flexii biceps cu gantere', 'Biceps', '10-12', 75],
      ['Flexii hammer', 'Biceps/Brahial', '10-12', 75],
      ['Dead bug', 'Core', '8-10/parte', 45],
    ],
    legs: [
      ['Genuflexiuni goblet', 'Cvadriceps/Fesieri', '8-12', 120],
      ['Hip thrust cu gantera', 'Fesieri', '8-12', 120],
      ['Fandări inverse cu gantere', 'Picioare', '8-10/parte', 90],
      ['Îndreptări românești cu gantere', 'Femurali/Fesieri', '8-12', 120],
      ['Step-up cu gantere', 'Picioare', '8-10/parte', 90],
      ['Genuflexiuni split', 'Cvadriceps/Fesieri', '8-10/parte', 90],
      ['Ridicări pe vârfuri cu gantere', 'Gambe', '12-20', 60],
      ['Side plank', 'Core', '25-40 sec/parte', 45],
    ],
    upper: [
      ['Împins cu gantere pe podea', 'Piept', '8-12', 120],
      ['Ramat cu gantera cu sprijin', 'Spate', '8-12/parte', 120],
      ['Împins înclinat cu gantere', 'Piept', '10-12', 90],
      ['Pullover cu gantera', 'Spate', '10-12', 90],
      ['Ridicări laterale cu gantere', 'Umeri', '12-15', 60],
      ['Reverse fly cu gantere', 'Umeri posteriori', '12-15', 60],
      ['Extensii triceps cu gantera', 'Triceps', '10-15', 75],
      ['Flexii biceps cu gantere', 'Biceps', '10-12', 75],
    ],
  },
  'no equipment': {
    push: [
      ['Flotări controlate', 'Piept/Triceps', 'AMRAP tehnic', 75],
      ['Flotări înclinate', 'Piept', '10-15', 60],
      ['Flotări diamant asistate', 'Triceps/Piept', '6-12', 75],
      ['Pike push-up ușor', 'Umeri', '6-10', 90],
      ['Dips la bancă controlate', 'Triceps', '8-12', 75],
      ['Plank shoulder taps', 'Core/Umeri', '8-12/parte', 45],
      ['Plank', 'Core', '30-45 sec', 45],
      ['Hollow hold', 'Core', '20-40 sec', 45],
    ],
    pull: [
      ['Superman pull', 'Spate', '12-15', 60],
      ['Reverse snow angel', 'Spate/Umeri posteriori', '10-15', 60],
      ['Prone Y-T-W', 'Umeri posteriori', '8-10/poziție', 60],
      ['Isometric towel row', 'Spate', '20-30 sec', 60],
      ['Good posture hold', 'Spate', '30-45 sec', 45],
      ['Side plank', 'Core', '25-40 sec/parte', 45],
      ['Dead bug', 'Core', '8-10/parte', 45],
      ['Bird dog', 'Core/Spate', '8-10/parte', 45],
    ],
    legs: [
      ['Genuflexiuni la greutatea corpului', 'Cvadriceps/Fesieri', '12-20', 75],
      ['Fandări inverse', 'Picioare', '8-12/parte', 90],
      ['Hip thrust la sol', 'Fesieri', '12-20', 75],
      ['Split squat asistat', 'Cvadriceps/Fesieri', '8-12/parte', 90],
      ['Glute bridge march', 'Fesieri/Core', '8-12/parte', 60],
      ['Wall sit', 'Cvadriceps', '30-45 sec', 60],
      ['Ridicări pe vârfuri', 'Gambe', '15-25', 45],
      ['Side plank', 'Core', '25-40 sec/parte', 45],
    ],
    upper: [
      ['Flotări controlate', 'Piept/Triceps', 'AMRAP tehnic', 75],
      ['Superman pull', 'Spate', '12-15', 60],
      ['Flotări înclinate', 'Piept', '10-15', 60],
      ['Reverse snow angel', 'Spate/Umeri posteriori', '10-15', 60],
      ['Pike push-up ușor', 'Umeri', '6-10', 90],
      ['Dips la bancă controlate', 'Triceps', '8-12', 75],
      ['Plank shoulder taps', 'Core/Umeri', '8-12/parte', 45],
      ['Dead bug', 'Core', '8-10/parte', 45],
    ],
  },
};

function getSessionFocuses(split, workoutsPerWeek) {
  if (split === 'Push/Pull/Legs') {
    const patterns = {
      2: ['push', 'pull'],
      3: ['push', 'pull', 'legs'],
      4: ['push', 'pull', 'legs', 'upper'],
      5: ['push', 'pull', 'legs', 'push', 'pull'],
    };
    return patterns[workoutsPerWeek] || patterns[3];
  }
  if (split === 'Upper/Lower') {
    const patterns = {
      2: ['upper', 'legs'],
      3: ['upper', 'legs', 'upper'],
      4: ['upper', 'legs', 'upper', 'legs'],
      5: ['upper', 'legs', 'upper', 'legs', 'upper'],
    };
    return patterns[workoutsPerWeek] || patterns[4];
  }
  if (split === 'Bro Split') {
    const patterns = {
      2: ['upper', 'legs'],
      3: ['push', 'pull', 'legs'],
      4: ['push', 'pull', 'legs', 'upper'],
      5: ['push', 'pull', 'legs', 'push', 'legs'],
    };
    return patterns[workoutsPerWeek] || patterns[4];
  }
  if (split === 'Full Body') {
    return Array.from({ length: workoutsPerWeek }, () => 'fullBody');
  }
  return Array.from({ length: workoutsPerWeek }, (_, idx) => (idx % 2 === 0 ? 'upper' : 'legs'));
}

function buildFallbackWorkoutPlan(input) {
  const workoutsPerWeek = input.workoutsPerWeek;
  const schedule = DAY_SCHEDULES[workoutsPerWeek] || DAY_SCHEDULES[3];
  const volume = getVolumeTargets(input.fitnessLevel, input.fitnessGoal, input.trainingSplit);
  const bank = FALLBACK_EXERCISES[input.availableEquipment] || FALLBACK_EXERCISES['full gym'];
  const focuses = getSessionFocuses(input.trainingSplit, workoutsPerWeek);
  const setsByLevel = input.fitnessLevel === 'beginner' ? 3 : 4;

  const days = focuses.map((focus, idx) => {
    const sourceExercises = focus === 'fullBody'
      ? [
          ...(bank.legs || []).slice(0, 2),
          ...(bank.push || []).slice(0, 3),
          ...(bank.pull || []).slice(0, 3),
          ...(bank.upper || []).slice(0, 2),
        ]
      : (bank[focus] || bank.upper);
    const exercises = sourceExercises.slice(0, volume.minExercises).map((ex, exIdx) => ({
      order: exIdx + 1,
      name: ex[0],
      muscleGroup: ex[1],
      sets: setsByLevel,
      reps: ex[2],
      restSeconds: Math.min(ex[3], volume.maxRestSeconds),
      instructions: 'Execută mișcarea controlat, păstrează postura stabilă și oprește setul când tehnica începe să se degradeze.',
      commonMistakes: 'Evită balansul, amplitudinea scurtată, graba între repetări și încărcarea care schimbă postura.',
    }));

    return {
      day: idx + 1,
      dayName: schedule[idx] || `Ziua ${idx + 1}`,
      isRestDay: false,
      sessionName: getSessionName(input.trainingSplit, focus, idx),
      estimatedDuration: Math.max(volume.minDuration, Math.min(volume.maxDuration, 55 + exercises.length * 5)),
      warmup: '5-8 minute cardio ușor, mobilitate pentru articulațiile lucrate și 2 seturi progresive la primul exercițiu.',
      cooldown: '5 minute respirație controlată, stretching ușor pentru grupele lucrate și mers lejer.',
      exercises,
    };
  });

  return {
    clientName: input.name,
    split: input.trainingSplit,
    fitnessLevel: input.fitnessLevel,
    fitnessGoal: input.fitnessGoal,
    workoutsPerWeek,
    days,
  };
}

function getSessionName(split, focus, idx) {
  if (split === 'Push/Pull/Legs') {
    return {
      push: 'Push - piept, umeri, triceps',
      pull: 'Pull - spate, biceps, posterior',
      legs: 'Legs - picioare și core',
      upper: 'Upper - push/pull accesorii',
    }[focus] || `Sesiunea ${idx + 1}`;
  }
  if (split === 'Upper/Lower') {
    return focus === 'legs' ? 'Lower - picioare și core' : 'Upper - partea superioară';
  }
  if (split === 'Bro Split') {
    return {
      push: 'Piept, umeri și triceps',
      pull: 'Spate și biceps',
      legs: 'Picioare',
      upper: 'Umeri, brațe și accesorii',
    }[focus] || `Sesiunea ${idx + 1}`;
  }
  return `Full Body ${idx + 1}`;
}

async function runDbRateLimit(supabase, userId, endpoint, maxRequests, windowMinutes) {
  const { data: result, error } = await supabaseQuery(() => supabase.rpc('check_rate_limit', {
    p_user_id: String(userId),
    p_endpoint: endpoint,
    p_max_requests: maxRequests,
    p_window_minutes: windowMinutes,
  }));

  if (error) return { allowed: true, retryAfter: null };
  if (!result?.length || result[0].allowed) return { allowed: true, retryAfter: null };

  const resetAt = result[0].reset_at ? new Date(result[0].reset_at) : null;
  const retryAfter = resetAt ? Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)) : null;
  return { allowed: false, retryAfter };
}

export async function POST(request) {
  const { ip, userAgent } = getRequestMeta(request);
  let auth = null;
  let clientIdForLogs = null;
  let clientNameForLogs = null;

  try {
    auth = verifyToken(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (auth.role !== 'trainer') {
      return NextResponse.json({ error: 'Acces interzis. Doar antrenorii pot genera planuri.' }, { status: 403 });
    }

    // ── Subscription check (live from DB — JWT can be stale) ─────────────
    const sub = await checkSubscription(auth.userId);
    if (!sub.allowed) return sub.response;

    const trainerId = Number.parseInt(String(auth.userId), 10);
    if (!Number.isFinite(trainerId)) {
      return NextResponse.json({ error: 'ID antrenor invalid în token.' }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
    }

    const supabase = getSupabase();

    const isInternalOrchestratedCall = request.headers.get('x-internal-plan-orchestrator') === '1';
    if (!isInternalOrchestratedCall) {
      const burstLimit = await runDbRateLimit(supabase, trainerId, 'generate-workout-plan-burst', 3, 1);
      if (!burstLimit.allowed) {
        return NextResponse.json(
          { error: 'Prea multe cereri într-un interval scurt. Încearcă din nou.' },
          { status: 429, headers: burstLimit.retryAfter ? { 'Retry-After': String(burstLimit.retryAfter) } : {} }
        );
      }

      const hourlyLimit = await runDbRateLimit(supabase, trainerId, 'generate-workout-plan', 12, 60);
      if (!hourlyLimit.allowed) {
        return NextResponse.json(
          { error: 'Limită de generare atinsă. Încearcă din nou mai târziu.' },
          { status: 429, headers: hourlyLimit.retryAfter ? { 'Retry-After': String(hourlyLimit.retryAfter) } : {} }
        );
      }

      const memoryLimit = checkRateLimit(String(trainerId));
      if (!memoryLimit.allowed) {
        return NextResponse.json(
          { error: memoryLimit.reason || 'Prea multe cereri.' },
          { status: 429, headers: memoryLimit.retryAfter ? { 'Retry-After': String(memoryLimit.retryAfter) } : {} }
        );
      }
    }

    const rawClientId = body?.clientId ? String(body.clientId).trim() : '';
    if (rawClientId && !UUID_RE.test(rawClientId)) {
      return NextResponse.json({ error: 'clientId invalid.' }, { status: 400 });
    }

    let ownedClient = null;
    if (rawClientId) {
      const { data, error } = await supabaseQuery(() => supabase
        .from('clients')
        .select('id, name, gender, activity_level, training_split, workouts_per_week, fitness_level, available_equipment, fitness_goal, goal, injuries_limitations, workout_preferences, user_id')
        .eq('id', rawClientId)
        .eq('trainer_id', trainerId)
        .is('deleted_at', null)
        .single());

      if (error || !data) {
        return NextResponse.json({ error: 'Clientul nu a fost găsit sau nu îți aparține.' }, { status: 404 });
      }
      ownedClient = data;
      clientIdForLogs = data.id;

      const usage = await reserveMonthlyClientUsage({
        trainerId,
        clientId: rawClientId,
        reason: 'workout_plan_generate',
        subscription: sub,
      });

      if (!usage.allowed) return usage.response;
    }

    const resolvedSplit = rawClientId
      ? resolveAllowedTrainingSplit(ownedClient?.training_split)
      : resolveAllowedTrainingSplit(body?.trainingSplit);
    if (!resolvedSplit) {
      const invalidValue = rawClientId ? ownedClient?.training_split : body?.trainingSplit;
      return NextResponse.json(
        {
          error: `Split invalid sau lipsă: "${String(invalidValue || '')}". Te rog salvează clientul cu unul dintre valorile: Full Body, Push/Pull/Legs, Upper/Lower, Bro Split.`,
        },
        { status: 400 }
      );
    }

    const input = {
      clientId: rawClientId || null,
      name: sanitizeName(String(ownedClient?.name || body?.name || '')),
      gender: String(ownedClient?.gender || body?.gender || 'M').toUpperCase().trim() === 'F' ? 'F' : 'M',
      trainingSplit: resolvedSplit,
      workoutsPerWeek: resolveWorkoutDays(ownedClient, body),
      fitnessLevel: safeEnum(String(ownedClient?.fitness_level || body?.fitnessLevel || 'beginner').toLowerCase().trim(), ALLOWED_LEVELS, 'beginner'),
      availableEquipment: safeEnum(String(ownedClient?.available_equipment || body?.availableEquipment || 'full gym').toLowerCase().trim(), ALLOWED_EQUIPMENT, 'full gym'),
      fitnessGoal: safeEnum(
        normalizeGoal(ownedClient?.fitness_goal || body?.fitnessGoal || normalizeGoal(ownedClient?.goal)),
        ALLOWED_GOALS,
        'muscle gain'
      ),
      injuriesLimitations: sanitizeText(String(ownedClient?.injuries_limitations || body?.injuriesLimitations || '')).slice(0, 800),
      workoutPreferences: sanitizeText(String(ownedClient?.workout_preferences || body?.workoutPreferences || '')).slice(0, 800),
      clientUserId: ownedClient?.user_id || null,
    };

    if (!input.name) {
      return NextResponse.json({ error: 'Câmpuri obligatorii lipsă: nume.' }, { status: 400 });
    }
    clientNameForLogs = input.name;

    const allowedEquipment = EXERCISE_EQUIPMENT_BY_PROFILE[input.availableEquipment] || null;
    const runExerciseQuery = (selectClause) => {
      let q = supabase.from('exercises').select(selectClause).eq('active', true);
      if (allowedEquipment && allowedEquipment.size > 0) {
        q = q.in('equipment', Array.from(allowedEquipment));
      }
      return q.order('name', { ascending: true });
    };

    let { data: exerciseRows, error: exerciseError } = await supabaseQuery(() =>
      runExerciseQuery('name, name_ro, muscle_group, movement_pattern, equipment, difficulty, is_compound, default_sets, default_reps, default_rest_seconds, active')
    );
    if (exerciseError && /name_ro/i.test(String(exerciseError.message || ''))) {
      ({ data: exerciseRows, error: exerciseError } = await supabaseQuery(() =>
        runExerciseQuery('name, muscle_group, movement_pattern, equipment, difficulty, is_compound, default_sets, default_reps, default_rest_seconds, active')
      ));
    }
    if (exerciseError) {
      throw new Error(`Nu am putut citi tabela exercises (${exerciseError.code || 'db_error'}: ${exerciseError.message}).`);
    }
    if (!Array.isArray(exerciseRows) || exerciseRows.length === 0) {
      throw new Error('Tabela exercises este goală pentru echipamentul selectat.');
    }
    const basicExerciseRows = exerciseRows.filter((row) => isBasicExerciseRow(row));
    if (!Array.isArray(basicExerciseRows) || basicExerciseRows.length === 0) {
      throw new Error('Nu am găsit exerciții de bază în tabela exercises pentru selecția curentă.');
    }

    const exerciseCatalogMap = buildExerciseCatalogMap(basicExerciseRows);
    const scopedCatalog = buildDayScopedExerciseCatalog(input, basicExerciseRows);
    const exerciseCatalogPrompt = scopedCatalog.promptText || buildExerciseCatalogPrompt(basicExerciseRows);
    const weeklyTargetsBase = getWeeklyExerciseTargets(input.trainingSplit, input.workoutsPerWeek);
    const weeklyTargets = applyGenderTargetOverrides(weeklyTargetsBase, input.gender, input.trainingSplit);

    // Extrage exercițiile din planul anterior pentru a evita repetiția
    let previousExercises = [];
    if (input.clientId) {
      const { data: prevPlanRow } = await supabaseQuery(() => supabase
        .from('workout_plans')
        .select('plan_data')
        .eq('client_id', input.clientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single());
      if (prevPlanRow?.plan_data) {
        previousExercises = extractExerciseNamesFromPlan(prevPlanRow.plan_data);
      }
    }

    // Folosește promptul de progres dacă cererea vine după actualizare progres
    const progressData = body?.progress || null;
    const isProgressRegeneration = !!(progressData?.forceRegenerate);
    const prompt = isProgressRegeneration
      ? buildWorkoutProgressPrompt(input, exerciseCatalogPrompt, weeklyTargets, previousExercises, progressData)
      : buildWorkoutPrompt(input, exerciseCatalogPrompt, weeklyTargets, previousExercises);
    console.log(`[generate-workout-plan] Tip generare: ${isProgressRegeneration ? 'progres' : 'prima generare'}`);
    const encoder = new TextEncoder();
    const requestId = generateRequestId();

    const responseStream = new ReadableStream({
      async start(controller) {
        let streamClosed = false;
        let slotAcquired = false;

        const send = (obj) => {
          if (streamClosed) return;
          try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch { streamClosed = true; }
        };
        const close = () => {
          if (!streamClosed) {
            streamClosed = true;
            try { controller.close(); } catch {}
          }
        };

        try {
          send({ type: 'progress', step: 1, total: 2, message: 'Se generează planul de antrenament cu AI...' });

          let plan = null;
          await requestQueue.waitForSlot(requestId);
          slotAcquired = true;

          const MAX_ATTEMPTS = 3;
          let lastValidationError = null;
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const attemptTemperature = attempt === 1 ? 0.35 : (attempt === 2 ? 0.5 : 0.65);
            let aiResponse;
            try {
              aiResponse = await withTimeout(
                openai.chat.completions.create(
                  {
                    model: WORKOUT_AI_MODEL,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: attemptTemperature,
                    max_tokens: WORKOUT_MAX_TOKENS,
                    response_format: { type: 'json_object' },
                  },
                  { timeout: OPENAI_WORKOUT_TIMEOUT_MS }
                ),
                OPENAI_WORKOUT_TIMEOUT_MS,
                'Generarea AI pentru planul de antrenament a durat prea mult.'
              );
            } catch (aiErr) {
              lastValidationError = aiErr;
              if (attempt === MAX_ATTEMPTS) break;
              continue;
            }
            const finishReason = aiResponse?.choices?.[0]?.finish_reason || null;
            const raw = aiResponse?.choices?.[0]?.message?.content;
            let parsed;
            try {
              parsed = parseWorkoutJson(raw);
            } catch (parseErr) {
              lastValidationError = finishReason === 'length'
                ? new Error('Răspuns AI trunchiat (max_tokens atins).')
                : parseErr;
              if (attempt === MAX_ATTEMPTS) break;
              continue;
            }
            let candidatePlan;
            try {
              candidatePlan = ensureWorkoutDayCount(
                normalizeGeneratedPlan(parsed, input, exerciseCatalogMap),
                input
              );
              validatePlan(candidatePlan, input, exerciseCatalogMap, null, null);
            } catch (validErr) {
              lastValidationError = validErr;
              if (attempt === MAX_ATTEMPTS) {
                // La ultima încercare: folosim planul normalizat chiar dacă nu trece validarea strictă,
                // iar dacă nu avem structură utilizabilă cădem pe planul local fallback.
                if (candidatePlan && Array.isArray(candidatePlan.days) && candidatePlan.days.length > 0) {
                  plan = candidatePlan;
                  break;
                }
                break;
              }
              continue;
            }
            plan = candidatePlan;
            break;
          }

          if (!plan) {
            console.warn(
              `[workout_plan.generate] Fallback local pentru ${input.workoutsPerWeek} sesiuni după eșec AI/validare: ${lastValidationError?.message || 'motiv necunoscut'}`
            );
            plan = buildFallbackWorkoutPlan(input);
          }

          let savedPlanId = null;
          if (input.clientId) {
            const { data: inserted, error: saveErr } = await supabaseQuery(() => supabase
              .from('workout_plans')
              .insert({
                client_id: input.clientId,
                trainer_id: trainerId,
                plan_data: plan,
              })
              .select('id')
              .single());

            if (saveErr) {
              throw new Error(`Nu am putut salva planul de antrenament (${saveErr.code || 'db_error'}: ${saveErr.message}).`);
            }
            savedPlanId = inserted?.id || null;

            if (savedPlanId && input.clientUserId) {
              await supabaseQuery(() => supabase
                .from('notifications')
                .insert({
                  user_id: input.clientUserId,
                  type: 'new_workout_plan',
                  title: 'Plan de antrenament nou',
                  message: 'Antrenorul tău a generat un plan de antrenament personalizat pentru tine.',
                  related_plan_id: savedPlanId,
                  related_client_id: input.clientId,
                  is_read: false,
                }));
            }
          }

          logActivity({
            action: 'workout_plan.generate',
            status: 'success',
            userId: trainerId,
            email: auth.email,
            ipAddress: ip,
            userAgent,
            details: { clientId: input.clientId, clientName: input.name },
          });

          send({ type: 'progress', step: 2, total: 2, message: 'Plan de antrenament generat cu succes.' });
          send({ type: 'complete', plan, planId: savedPlanId });
        } catch (err) {
          const message = String(err?.message || 'Eroare la generarea planului.');
          logActivity({
            action: 'workout_plan.generate',
            status: 'failure',
            userId: trainerId,
            email: auth.email,
            ipAddress: ip,
            userAgent,
            details: { clientId: input.clientId, clientName: input.name, error: message },
          });
          send({ type: 'error', message });
        } finally {
          if (slotAcquired) {
            requestQueue.releaseSlot();
          }
          close();
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    const message = String(err?.message || 'Eroare internă.');
    logActivity({
      action: 'workout_plan.generate',
      status: 'failure',
      userId: auth?.userId || null,
      email: auth?.email || null,
      ipAddress: ip,
      userAgent,
      details: { clientId: clientIdForLogs, clientName: clientNameForLogs, error: message },
    });
    return NextResponse.json({ error: 'Eroare la generarea planului de antrenament.' }, { status: 500 });
  }
}
