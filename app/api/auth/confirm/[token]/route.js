import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

const CONFIRMATION_TOKEN_PATTERN = /^(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i;

function authRedirect(request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  return NextResponse.redirect(new URL('/auth?confirmed=1', appUrl));
}

// GET /api/auth/confirm/[token]
export async function GET(request, { params }) {
  const supabase = getSupabase();
  const { ip, userAgent } = getRequestMeta(request);
  const { token } = await params;
  const shouldRedirect = new URL(request.url).searchParams.get('redirect') === '1';

  const confirmLimit = await enforceRateLimit(request, {
    identifier: `ip:${ip}`,
    endpoint: 'auth-confirm-email',
    maxRequests: 30,
    windowMinutes: 15,
    failClosed: true,
  });
  if (confirmLimit) return confirmLimit;

  if (!token) {
    return NextResponse.json({ error: 'Token lipsă.' }, { status: 400 });
  }

  if (String(token).length > 128 || !CONFIRMATION_TOKEN_PATTERN.test(String(token))) {
    await logActivity({ action: 'auth.confirm_email', status: 'failure', ipAddress: ip, userAgent, details: { reason: 'malformed_token' } });
    return NextResponse.json({ error: 'Link de confirmare invalid sau deja folosit.' }, { status: 404 });
  }

  // Find user with this token
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, name, status, confirmation_token_expires_at')
    .eq('confirmation_token', token)
    .maybeSingle();

  if (error || !user) {
    await logActivity({ action: 'auth.confirm_email', status: 'failure', ipAddress: ip, userAgent, details: { reason: 'token_not_found' } });
    return NextResponse.json({ error: 'Link de confirmare invalid sau deja folosit.' }, { status: 404 });
  }

  // Already confirmed
  if (user.status === 'confirmed') {
    if (shouldRedirect) return authRedirect(request);
    return NextResponse.json({ message: 'Email deja confirmat. Te poți autentifica.' }, { status: 200 });
  }

  // Check expiry
  if (new Date(user.confirmation_token_expires_at) < new Date()) {
    await logActivity({ action: 'auth.confirm_email', status: 'failure', userId: user.id, email: user.email, ipAddress: ip, userAgent, details: { reason: 'token_expired' } });
    return NextResponse.json({ error: 'Link-ul de confirmare a expirat. Înregistrează-te din nou.' }, { status: 410 });
  }

  // Mark as confirmed. B2C accounts start on the free plan.
  const { error: updateError } = await supabase
    .from('users')
    .update({
      status: 'confirmed',
      confirmation_token: null,
      confirmation_token_expires_at: null,
      account_type: 'free',
      subscription_status: 'free',
      subscription_plan: null,
    })
    .eq('id', user.id)
    .eq('confirmation_token', token);

  if (updateError) {
    console.error('[confirm] update error:', updateError);
    await logActivity({ action: 'auth.confirm_email', status: 'error', userId: user.id, email: user.email, ipAddress: ip, userAgent, details: { reason: 'db_error' } });
    return NextResponse.json({ error: 'Eroare la activarea contului. Încearcă din nou.' }, { status: 500 });
  }

  await logActivity({ action: 'auth.confirm_email', status: 'success', userId: user.id, email: user.email, ipAddress: ip, userAgent });

  if (shouldRedirect) return authRedirect(request);

  return NextResponse.json({ message: 'Email confirmat! Contul tău este acum activ.' }, { status: 200 });
}
