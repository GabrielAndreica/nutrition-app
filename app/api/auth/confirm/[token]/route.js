import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

// GET /api/auth/confirm/[token]
export async function GET(request, { params }) {
  const supabase = getSupabase();
  const { ip, userAgent } = getRequestMeta(request);
  const { token } = await params;

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
    .eq('id', user.id);

  if (updateError) {
    console.error('[confirm] update error:', updateError);
    await logActivity({ action: 'auth.confirm_email', status: 'error', userId: user.id, email: user.email, ipAddress: ip, userAgent, details: { reason: 'db_error' } });
    return NextResponse.json({ error: 'Eroare la activarea contului. Încearcă din nou.' }, { status: 500 });
  }

  await logActivity({ action: 'auth.confirm_email', status: 'success', userId: user.id, email: user.email, ipAddress: ip, userAgent });

  return NextResponse.json({ message: 'Email confirmat! Contul tău este acum activ.' }, { status: 200 });
}
