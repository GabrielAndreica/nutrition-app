/** @jest-environment node */

import { GET } from '@/app/api/clients/progress-status/route';
import { makeRequest, makeClient } from './helpers';
import { NextRequest } from 'next/server';

// ── Mock-uri ────────────────────────────────────────────────────────────────

const mockSelect = jest.fn();
const mockEq    = jest.fn();

jest.mock('@/app/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: mockSelect,
    }),
  }),
}));

jest.mock('@/app/lib/verifyToken', () => ({
  verifyToken: jest.fn((req) => {
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return { error: 'Unauthorized', status: 401 };
    return { userId: 379, role: 'trainer', email: 'trainer@test.com' };
  }),
}));

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Chainul implicit: .select().eq() → rezolvă cu date
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockResolvedValue({ data: [], error: null });
});

// ── Teste ────────────────────────────────────────────────────────────────────

describe('GET /api/clients/progress-status', () => {
  test('returnează 401 fără token', async () => {
    const req = new NextRequest('http://localhost/api/clients/progress-status');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  test('returnează 403 dacă role !== trainer', async () => {
    // Override verifyToken să returneze role=client
    const { verifyToken } = require('@/app/lib/verifyToken');
    verifyToken.mockReturnValueOnce({ userId: 'uuid-1', role: 'client' });

    const req = makeRequest('GET');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  test('returnează lista goală dacă nu există clienți', async () => {
    mockEq.mockResolvedValue({ data: [], error: null });
    const req = makeRequest('GET');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.statuses).toEqual([]);
  });

  test('returnează doar id și has_new_progress pentru fiecare client', async () => {
    const mockData = [
      { id: 'uuid-1', has_new_progress: true },
      { id: 'uuid-2', has_new_progress: false },
      { id: 'uuid-3', has_new_progress: true },
    ];
    mockEq.mockResolvedValue({ data: mockData, error: null });

    const req = makeRequest('GET');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.statuses).toHaveLength(3);
    expect(body.statuses[0]).toEqual({ id: 'uuid-1', has_new_progress: true });
    expect(body.statuses[2]).toEqual({ id: 'uuid-3', has_new_progress: true });
  });

  test('returnează 500 la eroare Supabase', async () => {
    mockEq.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const req = makeRequest('GET');
    const res = await GET(req);
    expect(res.status).toBe(500);
  });

  test('filtrează după trainer_id din token', async () => {
    mockEq.mockResolvedValue({ data: [], error: null });

    const req = makeRequest('GET');
    await GET(req);

    // Verifică că .eq('trainer_id', 379) a fost apelat cu userId-ul din token
    expect(mockEq).toHaveBeenCalledWith('trainer_id', 379);
  });
});
