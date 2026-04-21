/**
 * Shared test helpers and mock factories
 */

import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

/** Generează un JWT valid pentru teste */
export function makeToken(payload = {}) {
  return jwt.sign(
    { userId: 379, role: 'trainer', email: 'trainer@test.com', ...payload },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/** Creează un NextRequest mock cu Authorization header */
export function makeRequest(method = 'GET', body = null, extraPayload = {}) {
  const token = makeToken(extraPayload);
  const init = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest('http://localhost:3000/api/test', init);
}

/** Factory pentru un client mock */
export function makeClient(overrides = {}) {
  return {
    id: 'uuid-client-1',
    name: 'Ion Popescu',
    age: 30,
    weight: 80,
    height: 175,
    goal: 'weight_loss',
    gender: 'M',
    activity_level: 'moderate',
    diet_type: 'omnivore',
    allergies: null,
    meals_per_day: 3,
    food_preferences: null,
    created_at: new Date().toISOString(),
    user_id: null,
    trainer_id: 379,
    has_new_progress: false,
    client_invitations: [],
    ...overrides,
  };
}

/** Creează un mock Supabase query builder */
export function makeSupabaseMock(resolveWith = { data: null, error: null, count: 0 }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resolveWith),
    then: undefined,
  };
  // Când nu se apelează .single(), Promise-ul se rezolvă direct
  Object.defineProperty(builder, 'then', {
    get() { return Promise.resolve(resolveWith).then.bind(Promise.resolve(resolveWith)); },
  });
  return builder;
}
