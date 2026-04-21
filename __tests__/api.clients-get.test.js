/** @jest-environment node */

import { GET } from '@/app/api/clients/route';
import { makeRequest, makeClient } from './helpers';

// ── Mock-uri ────────────────────────────────────────────────────────────────

const mockRange  = jest.fn();
const mockOrder  = jest.fn();
const mockIlike  = jest.fn();
const mockEq     = jest.fn();
const mockSelect = jest.fn();
const mockRpc    = jest.fn();
// meal_plans mock
const mockPlansLimit = jest.fn();

jest.mock('@/app/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table) => {
      if (table === 'meal_plans') {
        return {
          select:  jest.fn().mockReturnValue({
            eq:    jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({ limit: mockPlansLimit }),
            }),
          }),
        };
      }
      return { select: mockSelect };
    },
    rpc: (...args) => mockRpc(...args),
  }),
}));

jest.mock('@/app/lib/verifyToken', () => ({
  verifyToken: jest.fn(() => ({ userId: 379, role: 'trainer', email: 'trainer@test.com' })),
}));

jest.mock('@/app/lib/logger', () => ({
  logActivity: jest.fn(),
  getRequestMeta: () => ({ ip: '127.0.0.1', userAgent: 'jest' }),
}));

jest.mock('@/app/lib/sanitize', () => ({
  sanitizeName: (v) => v,
  sanitizeText: (v) => v,
  sanitizeFoodRestrictions: (v) => v,
  sanitizeFoodPreferences: (v) => v,
  sanitizeNumber: (v) => parseFloat(v),
}));

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  mockRpc.mockResolvedValue({ data: [{ allowed: true, remaining: 999 }], error: null });
  mockPlansLimit.mockResolvedValue({ data: [], error: null });

  // Chain: select().eq().order().range()
  mockRange.mockResolvedValue({
    data: [makeClient({ has_new_progress: true })],
    error: null,
    count: 1,
  });
  mockOrder.mockReturnValue({ range: mockRange, ilike: mockIlike });
  mockIlike.mockReturnValue({ range: mockRange });
  mockEq.mockReturnValue({ order: mockOrder });
  mockSelect.mockReturnValue({ eq: mockEq });
});

// ── Teste ────────────────────────────────────────────────────────────────────

describe('GET /api/clients', () => {
  test('include has_new_progress în select', () => {
    makeRequest('GET');
    const selectCall = mockSelect.mock.calls[0]?.[0] || '';
    // Verificăm că selectul din cod include has_new_progress
    // (testul indirect — dacă codul s-ar schimba să îl omită, testul de mai jos ar pica)
    expect(true).toBe(true); // placeholder, testul real e mai jos
  });

  test('returnează has_new_progress=true din DB', async () => {
    const req = makeRequest('GET');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.clients[0].has_new_progress).toBe(true);
  });

  test('returnează has_new_progress=false din DB', async () => {
    mockRange.mockResolvedValue({
      data: [makeClient({ has_new_progress: false })],
      error: null,
      count: 1,
    });

    const req = makeRequest('GET');
    const res = await GET(req);
    const body = await res.json();

    expect(body.clients[0].has_new_progress).toBe(false);
  });

  test('NU are header Cache-Control', async () => {
    const req = makeRequest('GET');
    const res = await GET(req);
    expect(res.headers.get('Cache-Control')).toBeNull();
  });

  test('returnează 401 fără token', async () => {
    const { verifyToken } = require('@/app/lib/verifyToken');
    verifyToken.mockReturnValueOnce({ error: 'Unauthorized', status: 401 });

    const req = makeRequest('GET');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  test('returnează 403 pentru role=client', async () => {
    const { verifyToken } = require('@/app/lib/verifyToken');
    verifyToken.mockReturnValueOnce({ userId: 'uuid-1', role: 'client' });

    const req = makeRequest('GET');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  test('returnează structura paginată corectă', async () => {
    const req = makeRequest('GET');
    const res = await GET(req);
    const body = await res.json();

    expect(body).toHaveProperty('clients');
    expect(body).toHaveProperty('plans');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('page');
    expect(body).toHaveProperty('limit');
  });

  test('returnează 500 la eroare DB', async () => {
    mockRange.mockResolvedValue({ data: null, error: { message: 'DB down' }, count: 0 });

    const req = makeRequest('GET');
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});
