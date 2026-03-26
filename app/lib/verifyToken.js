import jwt from 'jsonwebtoken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Verifică token-ul JWT din header-ul Authorization.
 * Loghează automat expirarea token-ului (fire-and-forget).
 *
 * @param {Request} request
 * @returns {{ userId: string, email: string|null }
 *          | { error: string, status: number }}
 */
export function verifyToken(request) {
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Token JWT lipsă. Autentificare necesară.', status: 401 };
  }

  const rawToken = authHeader.substring(7);

  try {
    const decoded = jwt.verify(rawToken, JWT_SECRET);
    return {
      userId: String(decoded.userId || decoded.id || decoded.sub),
      email: decoded.email || null,
    };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      // Extrage datele din token fără verificare pentru log
      const decoded = jwt.decode(rawToken);
      const { ip, userAgent } = getRequestMeta(request);

      // Fire-and-forget — nu blochează răspunsul
      logActivity({
        action: 'auth.token_expired',
        status: 'failure',
        userId: decoded ? String(decoded.userId || decoded.id || decoded.sub) : null,
        email: decoded?.email || null,
        ipAddress: ip,
        userAgent,
        details: {
          expiredAt: decoded?.exp
            ? new Date(decoded.exp * 1000).toISOString()
            : null,
        },
      });

      return { error: 'Sesiunea a expirat. Autentifică-te din nou.', status: 401 };
    }

    return { error: 'Token JWT invalid.', status: 401 };
  }
}
