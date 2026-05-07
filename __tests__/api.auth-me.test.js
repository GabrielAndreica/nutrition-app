/** @jest-environment node */

/**
 * Teste pentru GET /api/auth/me
 * Acoperă: răspuns corect, token invalid, user negăsit, ETag 304.
 */

import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

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

jest.mock('@/app/lib/logger', () => ({
  logActivity:    jest.fn(),
  getRequestMeta: () => ({ ip: '127.0.0.1', userAgent: 'jest' }),
}));

// Importăm după mock-uri
import { GET } from '@/app/api/auth/me/route';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeToken(payload = {}) {
  return jwt.sign(
    { id: 'user-uuid-1', role: 'trainer', email: 'test@test.com', ...payload },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function makeReq(token, extraHeaders = {}) {
  return new NextRequest('http://localhost:3000/api/auth/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
  });
}

const futureDate = () => new Date(Date.now() + 10 * 86400_000).toISOString();

beforeEach(() => jest.clearAllMocks());

// ── Teste ────────────────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {

  test('răspuns 200 cu subscription_status, subscription_plan, trial_ends_at', async () => {
    const trialEnds = futureDate();
    mockSingle.mockResolvedValue({
      data: { subscription_status: 'trial', subscription_plan: null, trial_ends_at: trialEnds },
      error: null,
    });
    const res = await GET(makeReq(makeToken()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      subscription_status: 'trial',
      subscription_plan:   null,
      trial_ends_at:       trialEnds,
    });
  });

  test('răspuns 200 nu conține date sensibile (parolă, email etc.)', async () => {
    mockSingle.mockResolvedValue({
      data: { subscription_status: 'active', subscription_plan: 'starter', trial_ends_at: null },
      error: null,
    });
    const res = await GET(makeReq(makeToken()));
    const body = await res.json();
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('name');
  });

  test('header Cache-Control prezent cu private, max-age=60', async () => {
    mockSingle.mockResolvedValue({
      data: { subscription_status: 'trial', subscription_plan: null, trial_ends_at: futureDate() },
      error: null,
    });
    const res = await GET(makeReq(makeToken()));
    const cc = res.headers.get('Cache-Control');
    expect(cc).toContain('private');
    expect(cc).toContain('max-age=60');
  });

  test('header Vary: Authorization prezent', async () => {
    mockSingle.mockResolvedValue({
      data: { subscription_status: 'trial', subscription_plan: null, trial_ends_at: futureDate() },
      error: null,
    });
    const res = await GET(makeReq(makeToken()));
    expect(res.headers.get('Vary')).toBe('Authorization');
  });

  test('ETag prezent în răspuns', async () => {
    mockSingle.mockResolvedValue({
      data: { subscription_status: 'active', subscription_plan: 'pro', trial_ends_at: null },
      error: null,
    });
    const res = await GET(makeReq(makeToken()));
    expect(res.headers.get('ETag')).toBeTruthy();
  });

  test('If-None-Match cu ETag corect → 304 fără body', async () => {
    const trialEnds = futureDate();
    mockSingle.mockResolvedValue({
      data: { subscription_status: 'trial', subscription_plan: null, trial_ends_at: trialEnds },
      error: null,
    });
    // Obținem ETag-ul din primul request
    const firstRes = await GET(makeReq(makeToken()));
    const etag = firstRes.headers.get('ETag');

    // Al doilea request cu If-None-Match
    mockSingle.mockResolvedValue({
      data: { subscription_status: 'trial', subscription_plan: null, trial_ends_at: trialEnds },
      error: null,
    });
    const secondRes = await GET(makeReq(makeToken(), { 'if-none-match': etag }));
    expect(secondRes.status).toBe(304);
  });

  test('token lipsă → 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/me', {
      method: 'GET',
      headers: {},
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  test('token expirat → 401', async () => {
    const expiredToken = jwt.sign(
      { id: 'user-uuid-1', role: 'trainer' },
      JWT_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await GET(makeReq(expiredToken));
    expect(res.status).toBe(401);
  });

  test('token invalid (string random) → 401', async () => {
    const res = await GET(makeReq('not.a.valid.token'));
    expect(res.status).toBe(401);
  });

  test('user negăsit în DB → 404', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(makeReq(makeToken()));
    expect(res.status).toBe(404);
  });

  test('DB error → 404', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'DB error' } });
    const res = await GET(makeReq(makeToken()));
    expect(res.status).toBe(404);
  });

  test('subscription_plan null → returnează null (nu undefined)', async () => {
    mockSingle.mockResolvedValue({
      data: { subscription_status: 'trial', subscription_plan: null, trial_ends_at: null },
      error: null,
    });
    const res = await GET(makeReq(makeToken()));
    const body = await res.json();
    expect(body.subscription_plan).toBeNull();
    expect(body.trial_ends_at).toBeNull();
  });

});
