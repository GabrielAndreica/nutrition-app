import jwt from 'jsonwebtoken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

/**
 * POST /api/auth/signout
 * Înregistrează deconectarea utilizatorului în activity_logs.
 * Token-ul este decodificat (fără verificare) pentru a extrage userId/email.
 */
export async function POST(request) {
  const { ip, userAgent } = getRequestMeta(request);

  const authHeader = request.headers.get('authorization');
  const rawToken = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null;

  let userId = null;
  let email = null;

  if (rawToken) {
    try {
      const decoded = jwt.decode(rawToken); // fără verificare — doar extrage claims
      if (decoded) {
        userId = String(decoded.userId || decoded.id || decoded.sub);
        email = decoded.email || null;
      }
    } catch {
      // ignoră erorile de decodificare
    }
  }

  await logActivity({
    action: 'auth.logout',
    status: 'success',
    userId,
    email,
    ipAddress: ip,
    userAgent,
  });

  return Response.json({ ok: true });
}
