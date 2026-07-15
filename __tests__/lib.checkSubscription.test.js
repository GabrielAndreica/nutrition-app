/** @jest-environment node */

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

import {
  checkSubscription,
  invalidateSubscriptionCache,
  MAX_CLIENTS,
  SUB_STATUS,
  SUB_PLAN,
} from '@/app/lib/checkSubscription';

function mockUser(overrides = {}) {
  return {
    data: {
      account_type: 'free',
      subscription_status: SUB_STATUS.FREE,
      subscription_plan: null,
      total_clients_created: 0,
      ...overrides,
    },
    error: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const id of ['user-1', 'user-free', 'user-active', '999']) {
    invalidateSubscriptionCache(id);
  }
});

describe('checkSubscription()', () => {
  test('userId invalid → denied user_not_found fără DB call', async () => {
    const result = await checkSubscription(null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('user_not_found');
    expect(mockSingle).not.toHaveBeenCalled();
  });

  test('DB error → denied user_not_found cu status 401', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'DB error' } });
    const result = await checkSubscription('user-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('user_not_found');
    expect(result.response.status).toBe(401);
  });

  test('free → allowed, fără limită legacy de clienți', async () => {
    mockSingle.mockResolvedValue(mockUser());
    const result = await checkSubscription('user-free');
    expect(result.allowed).toBe(true);
    expect(result.status).toBe(SUB_STATUS.FREE);
    expect(result.accountType).toBe('free');
    expect(result.maxClients).toBe(MAX_CLIENTS.free);
  });

  test('active starter → paid, maxClients legacy starter', async () => {
    mockSingle.mockResolvedValue(mockUser({
      account_type: 'paid',
      subscription_status: SUB_STATUS.ACTIVE,
      subscription_plan: SUB_PLAN.STARTER,
    }));

    const result = await checkSubscription('user-active');
    expect(result.allowed).toBe(true);
    expect(result.accountType).toBe('paid');
    expect(result.maxClients).toBe(MAX_CLIENTS.starter);
  });

  test('active pro → maxClients legacy pro', async () => {
    mockSingle.mockResolvedValue(mockUser({
      account_type: 'paid',
      subscription_status: SUB_STATUS.ACTIVE,
      subscription_plan: SUB_PLAN.PRO,
    }));

    const result = await checkSubscription('user-active');
    expect(result.allowed).toBe(true);
    expect(result.maxClients).toBe(MAX_CLIENTS.pro);
  });

  test('status legacy cancelled este tratat ca permis pentru B2C free fallback', async () => {
    mockSingle.mockResolvedValue(mockUser({
      account_type: 'free',
      subscription_status: SUB_STATUS.CANCELLED,
    }));

    const result = await checkSubscription('user-free');
    expect(result.allowed).toBe(true);
    expect(result.status).toBe(SUB_STATUS.CANCELLED);
  });

  test('al doilea apel cu același userId folosește cache', async () => {
    mockSingle.mockResolvedValue(mockUser());
    invalidateSubscriptionCache('999');

    await checkSubscription('999');
    await checkSubscription('999');

    expect(mockSingle).toHaveBeenCalledTimes(1);
  });

  test('rezultatul allowed include câmpurile necesare', async () => {
    mockSingle.mockResolvedValue(mockUser({ total_clients_created: 1 }));
    const result = await checkSubscription('user-free');
    expect(result).toMatchObject({
      allowed: true,
      status: SUB_STATUS.FREE,
      accountType: 'free',
      plan: null,
      totalClientsCreated: 1,
      maxClients: MAX_CLIENTS.free,
    });
    expect(result.response).toBeUndefined();
  });
});
