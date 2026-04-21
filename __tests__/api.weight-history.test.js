/** @jest-environment node */

import { POST } from '@/app/api/clients/[id]/weight-history/route';
import { NextRequest } from 'next/server';

// ── Mock-uri ────────────────────────────────────────────────────────────────

// Stochează apelurile .update() pentru inspecție
let lastUpdatePayload = null;
let lastUpdateTable   = null;

const mockSingle  = jest.fn();
const mockSelect  = jest.fn();
const mockUpdate  = jest.fn();
const mockEqChain = jest.fn();
const mockInsert  = jest.fn();
const mockRpc     = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => {
      lastUpdateTable = table;
      return {
        select:  mockSelect,
        insert:  mockInsert,
        update:  (payload) => {
          lastUpdatePayload = { table, payload };
          return { eq: mockEqChain };
        },
      };
    },
    rpc: (...args) => mockRpc(...args),
  }),
}));

jest.mock('@/app/lib/verifyToken', () => ({
  verifyToken: jest.fn(),
}));

jest.mock('@/app/lib/logger', () => ({
  logActivity: jest.fn(),
  getRequestMeta: () => ({ ip: '127.0.0.1', userAgent: 'jest' }),
}));

jest.mock('@/app/lib/sanitize', () => ({
  sanitizeNumber: jest.fn((v) => parseFloat(v)),
  sanitizeText:   jest.fn((v) => v),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const { verifyToken } = require('@/app/lib/verifyToken');

function makeClientReq(body, roleOverride = 'client') {
  verifyToken.mockReturnValue({ userId: 'uuid-user-1', role: roleOverride, email: 'client@test.com' });
  return new NextRequest('http://localhost/api/clients/uuid-1/weight-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer valid' },
    body: JSON.stringify(body),
  });
}

const PARAMS = { params: Promise.resolve({ id: 'uuid-client-1' }) };

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  lastUpdatePayload = null;

  // Rate limit — permite implicit
  mockRpc.mockResolvedValue({ data: [{ allowed: true, remaining: 99 }], error: null });

  // select client → găsit
  mockSelect.mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: mockSingle }), single: mockSingle }) });
  mockSingle.mockResolvedValue({ data: { id: 'uuid-client-1', trainer_id: 379, name: 'Ion' }, error: null });

  // insert weight_history → succes
  mockInsert.mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: { id: 'wh-1', weight: 80 }, error: null }),
    }),
  });

  // update clients → succes
  mockEqChain.mockResolvedValue({ error: null });
});

// ── Teste ────────────────────────────────────────────────────────────────────

describe('POST weight-history — has_new_progress', () => {
  test('setează has_new_progress=true când role=client', async () => {
    const req = makeClientReq({ weight: 80, notes: '[CLIENT] Respectare: 90%' });
    await POST(req, PARAMS);

    // Verifică că update-ul pe clients include has_new_progress: true
    expect(lastUpdatePayload?.payload).toMatchObject({ has_new_progress: true });
  });

  test('NU setează has_new_progress când role=trainer', async () => {
    const req = makeClientReq({ weight: 82 }, 'trainer');
    await POST(req, PARAMS);

    // Trainer nu trebuie să seteze has_new_progress
    expect(lastUpdatePayload?.payload).not.toHaveProperty('has_new_progress');
  });

  test('include greutatea în update indiferent de rol', async () => {
    const req = makeClientReq({ weight: 78 });
    await POST(req, PARAMS);

    expect(lastUpdatePayload?.payload).toMatchObject({ weight: 78 });
  });

  test('returnează 401 fără token', async () => {
    verifyToken.mockReturnValue({ error: 'Unauthorized', status: 401 });
    const req = new NextRequest('http://localhost/api/test', { method: 'POST' });
    const res = await POST(req, PARAMS);
    expect(res.status).toBe(401);
  });

  test('returnează 403 pentru rol invalid', async () => {
    verifyToken.mockReturnValue({ userId: 1, role: 'admin' });
    const req = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer x', 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight: 80 }),
    });
    const res = await POST(req, PARAMS);
    expect(res.status).toBe(403);
  });

  test('returnează 429 când rate limit depășit', async () => {
    mockRpc.mockResolvedValue({
      data: [{ allowed: false, remaining: 0, reset_at: new Date(Date.now() + 3600000).toISOString() }],
      error: null,
    });
    const req = makeClientReq({ weight: 80 });
    const res = await POST(req, PARAMS);
    expect(res.status).toBe(429);
  });

  test('returnează 400 pentru greutate invalidă', async () => {
    const { sanitizeNumber } = require('@/app/lib/sanitize');
    sanitizeNumber.mockImplementation(() => { throw new Error('Greutate prea mică'); });

    const req = makeClientReq({ weight: 5 });
    const res = await POST(req, PARAMS);
    expect(res.status).toBe(400);
  });
});
