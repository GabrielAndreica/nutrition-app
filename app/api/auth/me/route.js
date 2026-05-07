import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

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
 *  - private, max-age=60 — browser/client cache 60s
 *  - stale-while-revalidate=120 — livrează stale + revalidează în background
 *  - ETag bazat pe status+plan+trial_ends_at pentru If-None-Match support
 */
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getSupabase();
  const { data: user, error } = await supabase
    .from('users')
    .select('subscription_status, subscription_plan, trial_ends_at')
    .eq('id', auth.userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 });
  }

  const payload = {
    subscription_status: user.subscription_status,
    subscription_plan:   user.subscription_plan ?? null,
    trial_ends_at:       user.trial_ends_at ?? null,
  };

  // ETag simplu — permite clientului să detecteze schimbări fără body
  const etag = `"${user.subscription_status}-${user.subscription_plan ?? 'none'}-${user.trial_ends_at ?? 'none'}"`;

  // 304 Not Modified dacă clientul are versiunea curentă
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': etag,
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
      },
    });
  }

  const res = NextResponse.json(payload);
  res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
  res.headers.set('ETag', etag);
  res.headers.set('Vary', 'Authorization');
  return res;
}
