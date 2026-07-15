/** @jest-environment node */

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

import { GET } from '@/app/api/auth/me/route';

function makeToken(payload = {}) {
  return jwt.sign(
    { id: 'user-1', role: 'user', email: 'test@test.com', ...payload },
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

beforeEach(() => jest.clearAllMocks());

describe('GET /api/auth/me', () => {
  test('returnează status B2C free/paid fără date sensibile', async () => {
    mockSingle.mockResolvedValue({
      data: { account_type: 'free', subscription_status: 'free', subscription_plan: null, plan: null },
      error: null,
    });

    const res = await GET(makeReq(makeToken()));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toEqual({
      account_type: 'free',
      subscription_status: 'free',
      subscription_plan: null,
    });
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('trial_ends_at');
  });

  test('derivează account_type paid când subscription_status este active', async () => {
    mockSingle.mockResolvedValue({
      data: { account_type: null, subscription_status: 'active', subscription_plan: 'starter', plan: null },
      error: null,
    });

    const res = await GET(makeReq(makeToken()));
    const body = await res.json();

    expect(body.account_type).toBe('paid');
    expect(body.subscription_status).toBe('active');
    expect(body.subscription_plan).toBe('starter');
  });

  test('setează Cache-Control no-store și Vary Authorization', async () => {
    mockSingle.mockResolvedValue({
      data: { account_type: 'free', subscription_status: 'free', subscription_plan: null, plan: null },
      error: null,
    });

    const res = await GET(makeReq(makeToken()));
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('Vary')).toBe('Authorization');
    expect(res.headers.get('ETag')).toBeNull();
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
      { id: 'user-1', role: 'user' },
      JWT_SECRET,
      { expiresIn: '-1s' }
    );
    const res = await GET(makeReq(expiredToken));
    expect(res.status).toBe(401);
  });

  test('user negăsit în DB → 404', async () => {
    mockSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(makeReq(makeToken()));
    expect(res.status).toBe(404);
  });
});
