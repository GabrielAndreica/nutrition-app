import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { getJwtSecret } from '@/app/lib/jwtSecret';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const { token, newPassword } = body;
  const { ip, userAgent } = getRequestMeta(request);

  if (!token) return NextResponse.json({ error: 'Token lipsă.' }, { status: 400 });
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: 'Parola trebuie să aibă cel puțin 8 caractere.' }, { status: 400 });
  }

  const rateLimit = await enforceRateLimit(request, {
    identifier: `ip:${ip}`,
    endpoint: 'auth-reset-password',
    maxRequests: 10,
    windowMinutes: 15,
  });
  if (rateLimit) return rateLimit;

  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch {
    await logActivity({ action: 'auth.password_reset', status: 'failure', ipAddress: ip, userAgent, details: { reason: 'invalid_or_expired_token' } });
    return NextResponse.json({ error: 'Link-ul de resetare este invalid sau a expirat.' }, { status: 400 });
  }

  if (payload.purpose !== 'password_reset') {
    await logActivity({ action: 'auth.password_reset', status: 'failure', ipAddress: ip, userAgent, details: { reason: 'wrong_token_purpose' } });
    return NextResponse.json({ error: 'Token invalid.' }, { status: 400 });
  }

  const supabase = getSupabase();
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  const { error } = await supabase
    .from('users')
    .update({ password: hashedPassword })
    .eq('id', payload.userId);

  if (error) {
    console.error('[reset-password] DB error:', error);
    await logActivity({ action: 'auth.password_reset', status: 'error', userId: payload.userId, email: payload.email, ipAddress: ip, userAgent, details: { error: error.message } });
    return NextResponse.json({ error: 'Eroare la resetarea parolei.' }, { status: 500 });
  }

  await logActivity({ action: 'auth.password_reset', status: 'success', userId: payload.userId, email: payload.email, ipAddress: ip, userAgent });
  return NextResponse.json({ success: true });
}
