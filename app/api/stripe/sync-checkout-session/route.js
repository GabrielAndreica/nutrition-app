import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { getStripe, getPlanTypeFromPriceId } from '@/app/lib/stripe';

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

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const sessionId = String(body?.sessionId || '').trim();
  if (!sessionId.startsWith('cs_')) {
    return NextResponse.json({ error: 'Sesiune Stripe invalidă.' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, role, stripe_customer_id')
    .eq('id', auth.userId)
    .single();

  if (userError || !user) {
    return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 });
  }

  if (user.role !== 'trainer') {
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
      return NextResponse.json({ error: 'Sesiunea Stripe nu aparține acestui cont.' }, { status: 403 });
    }

    if (session.mode !== 'subscription' || session.status !== 'complete') {
      return NextResponse.json({ error: 'Sesiunea Stripe nu este finalizată.' }, { status: 409 });
    }

    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      return NextResponse.json({ error: 'Plata Stripe nu este confirmată.' }, { status: 409 });
    }

    const verifiedPlanType = await getPlanFromCheckoutSession(stripe, session.id);
    if (!verifiedPlanType) {
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
    return NextResponse.json({ error: 'Nu am putut sincroniza plata Stripe.' }, { status: 500 });
  }
}
