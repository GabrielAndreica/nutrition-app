/** @jest-environment node */

import { PATCH } from '@/app/api/clients/[id]/route';
import { makeRequest } from './helpers';
import { NextRequest } from 'next/server';

// ── Mock-uri ────────────────────────────────────────────────────────────────

const mockUpdate = jest.fn();
const mockEq     = jest.fn();
const mockSelect = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ update: mockUpdate }),
  }),
}));

jest.mock('@/app/lib/verifyToken', () => ({
  verifyToken: jest.fn(() => ({ userId: 379, role: 'trainer', email: 'trainer@test.com' })),
}));

// ── Setup ────────────────────────────────────────────────────────────────────

const PARAMS = { params: Promise.resolve({ id: 'uuid-client-1' }) };

beforeEach(() => {
  jest.clearAllMocks();
  // chain: .update().eq().select() → { data: [{id, has_new_progress}], error: null }
  mockSelect.mockResolvedValue({ data: [{ id: 'uuid-client-1', has_new_progress: false }], error: null });
  mockEq.mockReturnValue({ select: mockSelect });
  mockUpdate.mockReturnValue({ eq: mockEq });
});

// ── Teste ────────────────────────────────────────────────────────────────────

describe('PATCH /api/clients/[id]', () => {
  test('returnează 401 fără token', async () => {
    const { verifyToken } = require('@/app/lib/verifyToken');
    verifyToken.mockReturnValueOnce({ error: 'Unauthorized', status: 401 });
    const req = new NextRequest('http://localhost/api/clients/uuid-1', { method: 'PATCH' });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(401);
  });

  test('setează has_new_progress=false cu succes', async () => {
    const req = makeRequest('PATCH', { has_new_progress: false });
    const res = await PATCH(req, PARAMS);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.updated).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith({ has_new_progress: false });
  });

  test('returnează 400 pentru câmpuri necunoscute', async () => {
    const req = makeRequest('PATCH', { name: 'Hacker', trainer_id: 999 });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(400);
  });

  test('returnează 400 pentru body gol', async () => {
    const req = makeRequest('PATCH', {});
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(400);
  });

  test('returnează success:false când nu se găsește clientul (0 rows)', async () => {
    mockSelect.mockResolvedValue({ data: [], error: null });

    const req = makeRequest('PATCH', { has_new_progress: false });
    const res = await PATCH(req, PARAMS);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.updated).toBe(0);
  });

  test('returnează 500 la eroare Supabase', async () => {
    mockSelect.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const req = makeRequest('PATCH', { has_new_progress: false });
    const res = await PATCH(req, PARAMS);
    expect(res.status).toBe(500);
  });

  test('filtrează corect după id din URL', async () => {
    const req = makeRequest('PATCH', { has_new_progress: false });
    await PATCH(req, PARAMS);

    expect(mockEq).toHaveBeenCalledWith('id', 'uuid-client-1');
  });
});
