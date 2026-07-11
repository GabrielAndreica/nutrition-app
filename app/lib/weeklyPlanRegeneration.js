import jwt from 'jsonwebtoken';
import { getSupabase, supabaseQuery } from '@/app/lib/supabase';
import { getJwtSecret } from '@/app/lib/jwtSecret';

const PLAN_TIME_ZONE = 'Europe/Bucharest';
const GENERATION_LOCK_MS = 30 * 60 * 1000;

function getTimeZoneParts(date, timeZone = PLAN_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  return parts;
}

function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone = PLAN_TIME_ZONE) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const localParts = getTimeZoneParts(utcGuess, timeZone);
  const localAsUtc = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second
  );
  return new Date(utcGuess.getTime() - (localAsUtc - utcGuess.getTime()));
}

export function getNextPlanMidnightIso(now = new Date()) {
  const currentLocal = getTimeZoneParts(now, PLAN_TIME_ZONE);
  const nextLocalDay = new Date(Date.UTC(currentLocal.year, currentLocal.month - 1, currentLocal.day + 1, 12));
  const nextParts = getTimeZoneParts(nextLocalDay, 'UTC');
  return zonedTimeToUtc({
    year: nextParts.year,
    month: nextParts.month,
    day: nextParts.day,
  }, PLAN_TIME_ZONE).toISOString();
}

export function getCurrentPlanDayIndex(now = new Date()) {
  const currentLocal = getTimeZoneParts(now, PLAN_TIME_ZONE);
  const localDateAtUtcMidnight = new Date(Date.UTC(
    currentLocal.year,
    currentLocal.month - 1,
    currentLocal.day
  ));
  return (localDateAtUtcMidnight.getUTCDay() + 6) % 7;
}

export function getCurrentPlanDateKey(now = new Date()) {
  const currentLocal = getTimeZoneParts(now, PLAN_TIME_ZONE);
  return [
    currentLocal.year,
    String(currentLocal.month).padStart(2, '0'),
    String(currentLocal.day).padStart(2, '0'),
  ].join('-');
}

export function getAppOrigin(request = null) {
  if (request?.nextUrl?.origin) return request.nextUrl.origin;
  if (request?.url) return new URL(request.url).origin;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function buildInternalUserToken(client) {
  return jwt.sign(
    {
      id: client.user_id,
      email: client.email || null,
      name: client.name || '',
      role: 'user',
    },
    getJwtSecret(),
    { expiresIn: '20m' }
  );
}

async function readNdjsonCompletion(response, onEvent = null) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('Răspuns invalid de la generatorul de planuri.');

  const decoder = new TextDecoder();
  let buffer = '';
  let completeEvent = null;

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
        throw new Error(event.message || 'Generarea automată a eșuat.');
      }
      onEvent?.(event);
      if (event.type === 'complete') {
        completeEvent = event;
      }
    }
  }

  return completeEvent;
}

export async function runWeeklyPlanRegenerationForClient({ clientId, request = null, force = false, onEvent = null } = {}) {
  if (!clientId) throw new Error('clientId lipsă pentru regenerarea săptămânală.');

  const supabase = getSupabase();
  const now = new Date();
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - GENERATION_LOCK_MS).toISOString();

  const { data: client, error: clientError } = await supabaseQuery(() => supabase
    .from('users')
    .select(`
      id,
      name,
      email,
      weekly_plan_due_at,
      weekly_plan_generation_started_at
    `)
    .eq('id', clientId)
    .maybeSingle());

  if (clientError || !client) {
    throw new Error('Utilizatorul nu a fost găsit pentru regenerarea săptămânală.');
  }

  const dueAt = client.weekly_plan_due_at ? new Date(client.weekly_plan_due_at) : null;
  if (!force && (!dueAt || dueAt > now)) {
    return { skipped: true, reason: 'not_due' };
  }

  const startedAt = client.weekly_plan_generation_started_at
    ? new Date(client.weekly_plan_generation_started_at)
    : null;
  if (!force && startedAt && startedAt > new Date(staleIso)) {
    return { skipped: true, reason: 'already_generating' };
  }

  const { data: locked, error: lockError } = await supabaseQuery(() => supabase
    .from('users')
    .update({
      weekly_plan_generation_started_at: nowIso,
      weekly_plan_generation_error: null,
    })
    .eq('id', clientId)
    .select('id')
    .maybeSingle());

  if (lockError || !locked) {
    throw new Error('Nu am putut porni regenerarea automată.');
  }

  try {
    const origin = getAppOrigin(request);
    const token = buildInternalUserToken({
      id: client.id,
      email: client.email || null,
    });

    const response = await fetch(`${origin}/api/generate-meal-plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-internal-weekly-regeneration': '1',
      },
      body: JSON.stringify({
        clientId,
        progress: {
          forceRegenerate: true,
          keepCurrentTargets: true,
          notes: 'Regenerare automată după finalizarea celor 7 zile.',
        },
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Generatorul de planuri a refuzat cererea automată.');
    }

    const completeEvent = await readNdjsonCompletion(response, onEvent);
    if (!completeEvent?.planId) {
      throw new Error('Planul alimentar automat nu a fost salvat.');
    }

    const now = new Date();
    await supabaseQuery(() => supabase
      .from('users')
      .update({
        meals_completed_days: 0,
        workout_completed_days: 0,
        current_plan_day: getCurrentPlanDayIndex(now),
        current_plan_day_due_at: getNextPlanMidnightIso(now),
        meal_day_status: {},
        workout_day_status: {},
        streak_awarded_day: -1,
        meals_cooldown_until: null,
        workout_cooldown_until: null,
        weekly_plan_due_at: null,
        weekly_plan_generation_started_at: null,
        weekly_plan_generation_error: null,
      })
      .eq('id', clientId));

    await supabaseQuery(() => supabase
      .from('notifications')
      .insert({
        user_id: client.id,
        type: 'weekly_plan_regenerated',
        title: 'Planuri noi generate',
        message: 'Ți-am generat automat un plan alimentar și un plan de antrenament pentru următoarele 7 zile.',
        related_client_id: clientId,
        related_plan_id: completeEvent.planId,
        is_read: false,
      }));

    return {
      success: true,
      mealPlanId: completeEvent.planId || null,
      workoutPlanId: completeEvent.workoutPlanId || null,
    };
  } catch (error) {
    await supabaseQuery(() => supabase
      .from('users')
      .update({
        weekly_plan_generation_started_at: null,
        weekly_plan_generation_error: String(error?.message || 'Generarea automată a eșuat.'),
      })
      .eq('id', clientId));
    throw error;
  }
}

export async function runDueWeeklyPlanRegenerations({ request = null, limit = 1 } = {}) {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();

  const { data: clients, error } = await supabaseQuery(() => supabase
    .from('users')
    .select('id, weekly_plan_generation_started_at')
    .not('weekly_plan_due_at', 'is', null)
    .lte('weekly_plan_due_at', nowIso)
    .order('weekly_plan_due_at', { ascending: true })
    .limit(Math.max(limit * 3, limit)));

  if (error) {
    throw new Error(`Nu am putut citi regenerările scadente (${error.message}).`);
  }

  const results = [];
  for (const client of clients || []) {
    if (results.length >= limit) break;
    const startedAt = client.weekly_plan_generation_started_at
      ? new Date(client.weekly_plan_generation_started_at)
      : null;
    if (startedAt && startedAt > new Date(Date.now() - GENERATION_LOCK_MS)) continue;

    try {
      const result = await runWeeklyPlanRegenerationForClient({ clientId: client.id, request });
      results.push({ clientId: client.id, ...result });
    } catch (err) {
      results.push({ clientId: client.id, success: false, error: String(err?.message || err) });
    }
  }

  return results;
}
