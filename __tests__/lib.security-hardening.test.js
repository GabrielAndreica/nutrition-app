/** @jest-environment node */

import jwt from 'jsonwebtoken';
import { verifyToken } from '@/app/lib/verifyToken';
import { sanitizeForLog } from '@/app/lib/sanitize';

jest.mock('@/app/lib/logger', () => ({
  logActivity: jest.fn(),
  getRequestMeta: () => ({ ip: '127.0.0.1', userAgent: 'jest' }),
}));

const SECRET = 'test-secret-with-enough-length-for-hardening';

function makeAuthRequest(token) {
  return new Request('http://localhost/api/test', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe('security hardening utilities', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
  });

  test('verifyToken acceptă doar JWT HS256 valid cu userId', () => {
    const token = jwt.sign(
      { userId: 379, email: 'trainer@test.com', role: 'trainer' },
      SECRET,
      { algorithm: 'HS256' }
    );

    expect(verifyToken(makeAuthRequest(token))).toEqual({
      userId: '379',
      email: 'trainer@test.com',
      role: 'trainer',
    });
  });

  test('verifyToken respinge token fără user id sau cu algoritm neașteptat', () => {
    const missingUserToken = jwt.sign({ email: 'x@test.com' }, SECRET, { algorithm: 'HS256' });
    const wrongAlgorithmToken = jwt.sign({ userId: 379 }, SECRET, { algorithm: 'HS384' });

    expect(verifyToken(makeAuthRequest(missingUserToken))).toMatchObject({ status: 401 });
    expect(verifyToken(makeAuthRequest(wrongAlgorithmToken))).toMatchObject({ status: 401 });
  });

  test('verifyToken respinge token supradimensionat înainte de verificare', () => {
    expect(verifyToken(makeAuthRequest('a'.repeat(4097)))).toMatchObject({ status: 401 });
  });

  test('sanitizeForLog redactează câmpuri sensibile recursiv', () => {
    const sanitized = sanitizeForLog({
      email: 'trainer@test.com',
      nested: {
        token: 'secret-token',
        Authorization: 'Bearer secret',
      },
      list: [{ api_key: 'abc123', value: 'ok' }],
    });

    expect(sanitized).toEqual({
      email: 'trainer@test.com',
      nested: {
        token: '[REDACTED]',
        Authorization: '[REDACTED]',
      },
      list: [{ api_key: '[REDACTED]', value: 'ok' }],
    });
  });
});
