import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { getStripe, getPlanTypeFromPriceId } from '@/app/lib/stripe';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function stripeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id || null;
}

async function getPlanFromCheckoutSession(stripe, sessionId) {
  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 1,
    expand: ['data.price'],
  });

  const priceId = lineItems.data?.[0]?.price?.id;
  return getPlanTypeFromPriceId(priceId);
}

function mapSubscriptionStatus(stripeStatus) {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'expired';
  if (stripeStatus === 'canceled') return 'cancelled';
  return null;
}

export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { ip, userAgent } = getRequestMeta(request);

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'stripe-sync-checkout-session',
    maxRequests: 30,
    windowMinutes: 5,
  });
  if (rateLimit) return rateLimit;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const sessionId = String(body?.sessionId || '').trim();
  if (!sessionId.startsWith('cs_')) {
    await logActivity({
      action: 'billing.checkout_sync',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'invalid_session_id' },
    });
    return NextResponse.json({ error: 'Sesiune Stripe invalidă.' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, role, stripe_customer_id')
    .eq('id', auth.userId)
    .single();

  if (userError || !user) {
    await logActivity({
      action: 'billing.checkout_sync',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'user_not_found', sessionId },
    });
    return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 });
  }

  if (user.role !== 'trainer') {
    await logActivity({
      action: 'billing.checkout_sync',
      status: 'blocked',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'non_trainer_role', role: user.role, sessionId },
    });
    return NextResponse.json({ error: 'Doar antrenorii pot sincroniza abonamente.' }, { status: 403 });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    const sessionUserId = session.metadata?.userId;
    const customerId = stripeId(session.customer);
    const belongsToUser =
      sessionUserId === String(auth.userId) ||
      (user.stripe_customer_id && customerId === user.stripe_customer_id);

    if (!belongsToUser) {
      await logActivity({
        action: 'billing.checkout_sync',
        status: 'blocked',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: { reason: 'session_not_owned', sessionId: session.id, customerId },
      });
      return NextResponse.json({ error: 'Sesiunea Stripe nu aparține acestui cont.' }, { status: 403 });
    }

    if (session.mode !== 'subscription' || session.status !== 'complete') {
      await logActivity({
        action: 'billing.checkout_sync',
        status: 'failure',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: { reason: 'session_not_complete', sessionId: session.id, mode: session.mode, stripeStatus: session.status },
      });
      return NextResponse.json({ error: 'Sesiunea Stripe nu este finalizată.' }, { status: 409 });
    }

    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      await logActivity({
        action: 'billing.checkout_sync',
        status: 'failure',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: { reason: 'payment_not_confirmed', sessionId: session.id, paymentStatus: session.payment_status },
      });
      return NextResponse.json({ error: 'Plata Stripe nu este confirmată.' }, { status: 409 });
    }

    const verifiedPlanType = await getPlanFromCheckoutSession(stripe, session.id);
    if (!verifiedPlanType) {
      await logActivity({
        action: 'billing.checkout_sync',
        status: 'failure',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: { reason: 'unknown_plan', sessionId: session.id },
      });
      return NextResponse.json({ error: 'Plan Stripe necunoscut.' }, { status: 400 });
    }

    const subscription = session.subscription;
    const subscriptionId = stripeId(subscription);
    const subscriptionStatus = mapSubscriptionStatus(subscription?.status) || 'active';

    const updates = {
      subscription_status: subscriptionStatus,
      subscription_id: subscriptionId,
      subscribed_at: new Date().toISOString(),
      subscription_plan: verifiedPlanType,
      plan: verifiedPlanType,
      stripe_customer_id: customerId,
    };

    const { error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('id', auth.userId);

    if (updateError) throw updateError;

    await logActivity({
      action: 'billing.checkout_sync',
      status: 'success',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: {
        sessionId: session.id,
        customerId,
        subscriptionId,
        subscriptionStatus,
        planType: verifiedPlanType,
      },
    });

    const payload = {
      subscription_status: updates.subscription_status,
      subscription_plan: updates.subscription_plan,
      trial_ends_at: null,
    };

    const res = NextResponse.json(payload);
    res.headers.set('Cache-Control', 'no-store, max-age=0');
    return res;
  } catch (error) {
    console.error('[stripe:sync-checkout-session]', error);
    await logActivity({
      action: 'billing.checkout_sync',
      status: 'error',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { sessionId, error: error.message },
    });
    return NextResponse.json({ error: 'Nu am putut sincroniza plata Stripe.' }, { status: 500 });
  }
}
