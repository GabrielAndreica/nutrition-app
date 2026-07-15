import { getSupabase } from '@/app/lib/supabase';
import { NextResponse } from 'next/server';

// ── Constante statusuri subscripție ───────────────────────────────────────
export const SUB_STATUS = /** @type {const} */ ({
  FREE:      'free',
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
  free:    0,
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
 *   accountType: string,
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
    .select('account_type, subscription_status, subscription_plan, total_clients_created')
    .eq('id', uid)
    .single();

  if (error || !user) {
    return _denied('user_not_found', 401, 'USER_NOT_FOUND', 'Cont negăsit sau eroare internă.');
  }

  const {
    account_type,
    subscription_status,
    subscription_plan,
    total_clients_created
  } = user;
  const accountType = account_type || (subscription_status === SUB_STATUS.ACTIVE ? 'paid' : 'free');
  const normalizedStatus = subscription_status || accountType;

  // Legacy client limits. B2C flow does not consume these.
  let maxClients = MAX_CLIENTS.free;
  if (normalizedStatus === SUB_STATUS.ACTIVE) {
    maxClients = subscription_plan === SUB_PLAN.PRO ? MAX_CLIENTS.pro : MAX_CLIENTS.starter;
  }

  const base = {
    status: normalizedStatus,
    accountType,
    plan: subscription_plan ?? null,
    totalClientsCreated: total_clients_created ?? 0,
    maxClients,
  };

  const result = { allowed: true, ...base };
  _cacheSet(uid, result);
  return result;
}

// ── Helper intern ──────────────────────────────────────────────────────────
function _denied(reason, httpStatus, code, message, base = {}) {
  return {
    allowed: false,
    status:               base.status  ?? 'unknown',
    accountType:          base.accountType ?? 'free',
    plan:                 base.plan    ?? null,
    totalClientsCreated:  base.totalClientsCreated ?? 0,
    maxClients:           base.maxClients ?? 0,
    reason,
    response: NextResponse.json({ error: message, code }, { status: httpStatus }),
  };
}
