import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { MAX_CLIENTS } from '@/app/lib/checkSubscription';

/**
 * GET /api/auth/me
 * Returnează datele live ale userului autentificat (subscription_status, trial_ends_at etc.)
 * Folosit de TrialBanner și AuthContext pentru a evita datele stale din JWT.
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
    .select('subscription_status, subscription_plan, plan, trial_ends_at')
    .eq('id', auth.userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 });
  }

  const plan = user.subscription_plan ?? user.plan ?? null;
  const maxClients = user.subscription_status === 'active'
    ? (plan === 'pro' ? MAX_CLIENTS.pro : MAX_CLIENTS.starter)
    : MAX_CLIENTS.trial;

  let monthlyClientUsage = null;
  if (auth.role === 'trainer') {
    const periodStart = new Date();
    periodStart.setUTCDate(1);
    periodStart.setUTCHours(0, 0, 0, 0);

    try {
      const { count, error: usageError } = await supabase
        .from('client_usage_ledger')
        .select('id', { count: 'exact', head: true })
        .eq('trainer_id', auth.userId)
        .eq('billing_period_start', periodStart.toISOString());

      monthlyClientUsage = {
        used: usageError ? 0 : (count ?? 0),
        limit: maxClients,
        period_start: periodStart.toISOString(),
      };
    } catch (usageError) {
      console.error('[auth/me] monthly usage lookup failed:', usageError);
    }
  }

  const payload = {
    subscription_status: user.subscription_status,
    subscription_plan:   plan,
    trial_ends_at:       user.trial_ends_at ?? null,
  };

  if (monthlyClientUsage) {
    payload.monthly_client_usage = monthlyClientUsage;
  }

  const res = NextResponse.json(payload);
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  res.headers.set('Vary', 'Authorization');
  return res;
}
