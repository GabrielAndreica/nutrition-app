import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { getStripe } from '@/app/lib/stripe';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

export const runtime = 'nodejs';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://trevano.app';

export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { ip, userAgent } = getRequestMeta(request);

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'stripe-create-portal-session',
    maxRequests: 20,
    windowMinutes: 10,
  });
  if (rateLimit) return rateLimit;

  const supabase = getSupabase();
  const { data: user, error } = await supabase
    .from('users')
    .select('stripe_customer_id, role')
    .eq('id', auth.userId)
    .single();

  if (error || !user) {
    await logActivity({
      action: 'billing.portal_create',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'user_not_found' },
    });
    return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 });
  }

  if (user.role !== 'trainer') {
    await logActivity({
      action: 'billing.portal_create',
      status: 'blocked',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'non_trainer_role', role: user.role },
    });
    return NextResponse.json({ error: 'Doar antrenorii pot gestiona abonamente.' }, { status: 403 });
  }

  if (!user.stripe_customer_id) {
    await logActivity({
      action: 'billing.portal_create',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'missing_customer_id' },
    });
    return NextResponse.json({ error: 'Nu există un client Stripe pentru acest cont.' }, { status: 400 });
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${APP_URL}/dashboard`,
    });

    await logActivity({
      action: 'billing.portal_create',
      status: 'success',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { sessionId: session.id, customerId: user.stripe_customer_id },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[stripe:create-portal-session]', err);
    await logActivity({
      action: 'billing.portal_create',
      status: 'error',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { error: err.message, customerId: user.stripe_customer_id },
    });
    return NextResponse.json({ error: 'Nu am putut deschide portalul de billing.' }, { status: 500 });
  }
}
