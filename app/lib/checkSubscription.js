import { getSupabase } from '@/app/lib/supabase';
import { NextResponse } from 'next/server';

// ── Constante statusuri subscripție ───────────────────────────────────────
export const SUB_STATUS = /** @type {const} */ ({
  TRIAL:     'trial',
  ACTIVE:    'active',
  CANCELLED: 'cancelled',
  INACTIVE:  'inactive',
  EXPIRED:   'expired',
});

export const SUB_PLAN = /** @type {const} */ ({
  STARTER: 'starter',
  PRO:     'pro',
});

export const MAX_CLIENTS = {
  trial:   3,
  starter: 10,
  pro:     30,
};

// ── In-memory cache (TTL = 30s) — reduce DB round-trips pe hot paths ──────
// Nu folosim Redis; pe serverless fiecare instanță are cache propriu.
// TTL scurt (30s) = trade-off bun: max 30s lag la upgrade vs. 0 extra latency.
const _cache = new Map(); // userId → { data, expiresAt }
const CACHE_TTL_MS = 30_000;

function _cacheGet(userId) {
  const entry = _cache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(userId); return null; }
  return entry.data;
}

function _cacheSet(userId, data) {
  _cache.set(userId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Invalidează manual cache-ul pentru un user (ex: după upgrade) */
export function invalidateSubscriptionCache(userId) {
  _cache.delete(String(userId));
}

/**
 * Verifică live din DB dacă utilizatorul are dreptul să folosească aplicația.
 * Nu se bazează pe JWT (poate fi vechi) — citește direct din tabela users.
 * Rezultatele sunt cache-uite 30s per instanță serverless.
 *
 * @param {string|number} userId
 * @returns {Promise<{
 *   allowed: boolean,
 *   status: string,
 *   plan: string|null,
 *   trialEndsAt: string|null,
 *   totalClientsCreated: number,
 *   maxClients: number,
 *   reason?: string,
 *   response?: NextResponse,
 * }>}
 */
export async function checkSubscription(userId) {
  const uid = String(userId ?? '').trim();
  if (!uid) {
    return _denied('user_not_found', 401, 'USER_NOT_FOUND', 'Cont negăsit sau eroare internă.');
  }

  // Cache hit
  const cached = _cacheGet(uid);
  if (cached) return cached;

  const supabase = getSupabase();

  const { data: user, error } = await supabase
    .from('users')
    .select('subscription_status, subscription_plan, trial_ends_at, total_clients_created')
    .eq('id', uid)
    .single();

  if (error || !user) {
    return _denied('user_not_found', 401, 'USER_NOT_FOUND', 'Cont negăsit sau eroare internă.');
  }

  const { subscription_status, subscription_plan, trial_ends_at, total_clients_created } = user;

  // Determine max clients
  let maxClients = MAX_CLIENTS.trial;
  if (subscription_status === SUB_STATUS.ACTIVE) {
    maxClients = subscription_plan === SUB_PLAN.PRO ? MAX_CLIENTS.pro : MAX_CLIENTS.starter;
  }

  const base = {
    status: subscription_status,
    plan: subscription_plan ?? null,
    trialEndsAt: trial_ends_at ?? null,
    totalClientsCreated: total_clients_created ?? 0,
    maxClients,
  };

  // Trial expired
  if (subscription_status === SUB_STATUS.TRIAL) {
    if (trial_ends_at && new Date(trial_ends_at) < new Date()) {
      const result = _denied('trial_expired', 403, 'TRIAL_EXPIRED',
        'Perioada de trial a expirat. Alege un plan pentru a continua.', base);
      _cacheSet(uid, result);
      return result;
    }
  }

  // Subscription inactive / cancelled
  if (
    subscription_status === SUB_STATUS.CANCELLED
    || subscription_status === SUB_STATUS.INACTIVE
    || subscription_status === SUB_STATUS.EXPIRED
  ) {
    const result = _denied('subscription_inactive', 403, 'SUBSCRIPTION_INACTIVE',
      'Abonamentul tău este inactiv. Reactivează-l pentru a continua.', base);
    _cacheSet(uid, result);
    return result;
  }

  const result = { allowed: true, ...base };
  _cacheSet(uid, result);
  return result;
}

// ── Helper intern ──────────────────────────────────────────────────────────
function _denied(reason, httpStatus, code, message, base = {}) {
  return {
    allowed: false,
    status:               base.status  ?? 'unknown',
    plan:                 base.plan    ?? null,
    trialEndsAt:          base.trialEndsAt ?? null,
    totalClientsCreated:  base.totalClientsCreated ?? 0,
    maxClients:           base.maxClients ?? 0,
    reason,
    response: NextResponse.json({ error: message, code }, { status: httpStatus }),
  };
}
