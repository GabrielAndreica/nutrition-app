import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

/**
 * GET /api/auth/me
 * Returnează datele live ale userului autentificat pentru cont B2C free/paid.
 *
 * Securitate:
 *  - Necesită JWT valid (verifyToken)
 *  - Rate-limit implicit prin Supabase service role (nu expus public)
 *  - Nu returnează date sensibile (parolă, email etc.)
 *
 * Caching:
 *  - no-store — statusul de subscription se schimbă prin webhook Stripe și
 *    trebuie citit live ca să nu blocăm userul cu date stale.
 */
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getSupabase();
  const { data: user, error } = await supabase
    .from('users')
    .select('account_type, subscription_status, subscription_plan, plan')
    .eq('id', auth.userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 });
  }

  const plan = user.subscription_plan ?? user.plan ?? null;
  const accountType = user.account_type || (user.subscription_status === 'active' ? 'paid' : 'free');

  const payload = {
    account_type: accountType,
    subscription_status: user.subscription_status || accountType,
    subscription_plan:   plan,
  };

  const res = NextResponse.json(payload);
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  res.headers.set('Vary', 'Authorization');
  return res;
}
