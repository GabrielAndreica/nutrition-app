import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Înregistrează un eveniment de activitate în baza de date.
 * Nu aruncă niciodată eroare — erorile de logging sunt gestionate intern
 * și nu afectează fluxul principal al aplicației.
 *
 * @param {Object}  params
 * @param {string}  params.action      - Acțiunea logată (ex: 'auth.signin', 'client.create')
 * @param {string}  params.status      - 'success' | 'failure' | 'error' | 'blocked'
 * @param {string}  [params.userId]    - UUID-ul utilizatorului autentificat
 * @param {string}  [params.email]     - Email-ul implicat (util pentru auth înainte de userId)
 * @param {string}  [params.ipAddress] - Adresa IP a clientului
 * @param {string}  [params.userAgent] - User-Agent al clientului
 * @param {Object}  [params.details]   - Date suplimentare în format JSON
 */
export async function logActivity({
  action,
  status,
  userId = null,
  email = null,
  ipAddress = null,
  userAgent = null,
  details = null,
}) {
  try {
    const { error } = await supabase.from('activity_logs').insert([{
      action,
      status,
      user_id: userId,
      email: email ? email.toLowerCase() : null,
      ip_address: ipAddress,
      user_agent: userAgent,
      details,
    }]);

    if (error) {
      console.error('[Logger] Eroare la inserare:', error.message);
    }
  } catch (err) {
    console.error('[Logger] Eroare neașteptată:', err.message);
  }
}

/**
 * Extrage adresa IP și User-Agent din request-ul Next.js.
 * Funcționează atât în development cât și în spatele unui proxy/CDN.
 */
export function getRequestMeta(request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  return { ip, userAgent };
}
