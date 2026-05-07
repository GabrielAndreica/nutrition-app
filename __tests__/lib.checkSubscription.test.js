/** @jest-environment node */

/**
 * Teste unitare pentru app/lib/checkSubscription.js
 * Acoperă: trial valid, trial expirat, active starter, active pro,
 *           cancelled, inactive, user_not_found, userId invalid,
 *           cache hit, cache invalidare.
 */

// ── Mock Supabase ────────────────────────────────────────────────────────────
const mockSingle = jest.fn();

jest.mock('@/app/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockSingle,
        }),
      }),
    }),
  }),
}));

// Importăm DUPĂ mock
import {
  checkSubscription,
  invalidateSubscriptionCache,
  MAX_CLIENTS,
  SUB_STATUS,
  SUB_PLAN,
} from '@/app/lib/checkSubscription';

// ── Helpers ──────────────────────────────────────────────────────────────────

const futureDate  = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(); // +10 zile
const pastDate    = () => new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();  // ieri

function mockUser(overrides = {}) {
  return {
    data: {
      subscription_status: SUB_STATUS.TRIAL,
      subscription_plan:   null,
      trial_ends_at:       futureDate(),
      total_clients_created: 0,
      ...overrides,
    },
    error: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Invalidăm cache-ul între teste pentru a evita interferențe
  invalidateSubscriptionCache('user-1');
  invalidateSubscriptionCache('user-2');
  invalidateSubscriptionCache('user-trial');
  invalidateSubscriptionCache('user-active');
  invalidateSubscriptionCache('user-cancelled');
  invalidateSubscriptionCache('user-inactive');
  invalidateSubscriptionCache('999');
});

// ── Teste ────────────────────────────────────────────────────────────────────

describe('checkSubscription()', () => {

  // ── Input validation ─────────────────────────────────────────────────────

  test('userId null → denied user_not_found fără DB call', async () => {
    const result = await checkSubscription(null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('user_not_found');
    expect(mockSingle).not.toHaveBeenCalled();
  });

  test('userId undefined → denied user_not_found fără DB call', async () => {
    const result = await checkSubscription(undefined);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('user_not_found');
    expect(mockSingle).not.toHaveBeenCalled();
  });

  test('userId string gol → denied user_not_found fără DB call', async () => {
    const result = await checkSubscription('   ');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('user_not_found');
    expect(mockSingle).not.toHaveBeenCalled();
  });

  // ── DB errors ────────────────────────────────────────────────────────────

  test('DB error → denied user_not_found cu status 401', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'DB error' } });
    const result = await checkSubscription('user-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('user_not_found');
    const res = result.response;
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('USER_NOT_FOUND');
  });

  test('DB returns null user → denied user_not_found', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const result = await checkSubscription('user-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('user_not_found');
  });

  // ── Trial valid ───────────────────────────────────────────────────────────

  test('trial activ cu zile rămase → allowed', async () => {
    mockSingle.mockResolvedValue(mockUser({ trial_ends_at: futureDate() }));
    const result = await checkSubscription('user-trial');
    expect(result.allowed).toBe(true);
    expect(result.status).toBe(SUB_STATUS.TRIAL);
    expect(result.maxClients).toBe(MAX_CLIENTS.trial);
    expect(result.reason).toBeUndefined();
  });

  test('trial fără trial_ends_at → allowed (niciodată expirat)', async () => {
    mockSingle.mockResolvedValue(mockUser({ trial_ends_at: null }));
    const result = await checkSubscription('user-trial');
    expect(result.allowed).toBe(true);
  });

  // ── Trial expirat ─────────────────────────────────────────────────────────

  test('trial expirat → denied cu status 403 și cod TRIAL_EXPIRED', async () => {
    mockSingle.mockResolvedValue(mockUser({ trial_ends_at: pastDate() }));
    const result = await checkSubscription('user-2');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('trial_expired');
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.code).toBe('TRIAL_EXPIRED');
  });

  // ── Active Starter ────────────────────────────────────────────────────────

  test('active starter → allowed, maxClients=10', async () => {
    mockSingle.mockResolvedValue(mockUser({
      subscription_status: SUB_STATUS.ACTIVE,
      subscription_plan:   SUB_PLAN.STARTER,
      trial_ends_at:       null,
    }));
    const result = await checkSubscription('user-active');
    expect(result.allowed).toBe(true);
    expect(result.maxClients).toBe(MAX_CLIENTS.starter);
  });

  // ── Active Pro ────────────────────────────────────────────────────────────

  test('active pro → allowed, maxClients=30', async () => {
    mockSingle.mockResolvedValue(mockUser({
      subscription_status: SUB_STATUS.ACTIVE,
      subscription_plan:   SUB_PLAN.PRO,
      trial_ends_at:       null,
    }));
    const result = await checkSubscription('user-active');
    expect(result.allowed).toBe(true);
    expect(result.maxClients).toBe(MAX_CLIENTS.pro);
  });

  // ── Cancelled / Inactive ──────────────────────────────────────────────────

  test('cancelled → denied cu cod SUBSCRIPTION_INACTIVE și status 403', async () => {
    mockSingle.mockResolvedValue(mockUser({ subscription_status: SUB_STATUS.CANCELLED }));
    const result = await checkSubscription('user-cancelled');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('subscription_inactive');
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  test('inactive → denied cu cod SUBSCRIPTION_INACTIVE', async () => {
    mockSingle.mockResolvedValue(mockUser({ subscription_status: SUB_STATUS.INACTIVE }));
    const result = await checkSubscription('user-inactive');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('subscription_inactive');
  });

  // ── total_clients_created ─────────────────────────────────────────────────

  test('returnează totalClientsCreated din DB', async () => {
    mockSingle.mockResolvedValue(mockUser({ total_clients_created: 2 }));
    const result = await checkSubscription('user-trial');
    expect(result.totalClientsCreated).toBe(2);
  });

  test('total_clients_created null → returnează 0', async () => {
    mockSingle.mockResolvedValue(mockUser({ total_clients_created: null }));
    const result = await checkSubscription('user-trial');
    expect(result.totalClientsCreated).toBe(0);
  });

  // ── Cache ─────────────────────────────────────────────────────────────────

  test('al doilea apel cu același userId folosește cache (nu apelează DB din nou)', async () => {
    mockSingle.mockResolvedValue(mockUser({ trial_ends_at: futureDate() }));
    invalidateSubscriptionCache('999');

    await checkSubscription('999');
    await checkSubscription('999');

    expect(mockSingle).toHaveBeenCalledTimes(1); // cache hit la al doilea apel
  });

  test('invalidateSubscriptionCache forțează re-fetch din DB', async () => {
    mockSingle.mockResolvedValue(mockUser({ trial_ends_at: futureDate() }));
    invalidateSubscriptionCache('999');

    await checkSubscription('999');
    invalidateSubscriptionCache('999');
    await checkSubscription('999');

    expect(mockSingle).toHaveBeenCalledTimes(2);
  });

  // ── Response body structure ───────────────────────────────────────────────

  test('rezultatul allowed include toate câmpurile necesare', async () => {
    const trialEnds = futureDate();
    mockSingle.mockResolvedValue(mockUser({
      trial_ends_at: trialEnds,
      total_clients_created: 1,
    }));
    const result = await checkSubscription('user-trial');
    expect(result).toMatchObject({
      allowed:             true,
      status:              SUB_STATUS.TRIAL,
      plan:                null,
      trialEndsAt:         trialEnds,
      totalClientsCreated: 1,
      maxClients:          MAX_CLIENTS.trial,
    });
    expect(result.response).toBeUndefined();
  });

});
