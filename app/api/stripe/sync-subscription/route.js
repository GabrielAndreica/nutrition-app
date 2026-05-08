import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { getStripe, getPlanTypeFromPriceId } from '@/app/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mapSubscriptionStatus(stripeStatus) {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'expired';
  if (stripeStatus === 'canceled') return 'cancelled';
  return null;
}

function getPlanFromSubscription(subscription) {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  return getPlanTypeFromPriceId(priceId);
}

function pickRelevantSubscription(subscriptions) {
  return (
    subscriptions.find(sub => sub.status === 'active' || sub.status === 'trialing') ||
    subscriptions.find(sub => sub.status === 'past_due' || sub.status === 'unpaid') ||
    subscriptions.find(sub => sub.status === 'canceled') ||
    null
  );
}

export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getSupabase();
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, role, stripe_customer_id, subscription_status, subscription_plan, plan, trial_ends_at')
    .eq('id', auth.userId)
    .single();

  if (userError || !user) {
    return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 });
  }

  if (user.role !== 'trainer') {
    return NextResponse.json({ error: 'Doar antrenorii pot sincroniza abonamente.' }, { status: 403 });
  }

  if (!user.stripe_customer_id) {
    return NextResponse.json({
      subscription_status: user.subscription_status,
      subscription_plan: user.subscription_plan ?? user.plan ?? null,
      trial_ends_at: user.trial_ends_at ?? null,
    });
  }

  try {
    const stripe = getStripe();
    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripe_customer_id,
      status: 'all',
      limit: 10,
      expand: ['data.items.data.price'],
    });

    const subscription = pickRelevantSubscription(subscriptions.data || []);
    if (!subscription) {
      return NextResponse.json({
        subscription_status: user.subscription_status,
        subscription_plan: user.subscription_plan ?? user.plan ?? null,
        trial_ends_at: user.trial_ends_at ?? null,
      });
    }

    const subscriptionStatus = mapSubscriptionStatus(subscription.status);
    const subscriptionPlan = getPlanFromSubscription(subscription);

    if (!subscriptionStatus) {
      return NextResponse.json({
        subscription_status: user.subscription_status,
        subscription_plan: user.subscription_plan ?? user.plan ?? null,
        trial_ends_at: user.trial_ends_at ?? null,
      });
    }

    const updates = {
      subscription_status: subscriptionStatus,
      subscription_id: subscription.id,
    };

    if (subscriptionStatus === 'active') {
      updates.subscribed_at = new Date().toISOString();
    }

    if (subscriptionPlan) {
      updates.subscription_plan = subscriptionPlan;
      updates.plan = subscriptionPlan;
    }

    const { error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('id', auth.userId);

    if (updateError) throw updateError;

    const payload = {
      subscription_status: updates.subscription_status,
      subscription_plan: updates.subscription_plan ?? user.subscription_plan ?? user.plan ?? null,
      trial_ends_at: null,
    };

    const res = NextResponse.json(payload);
    res.headers.set('Cache-Control', 'no-store, max-age=0');
    return res;
  } catch (error) {
    console.error('[stripe:sync-subscription]', error);
    return NextResponse.json({ error: 'Nu am putut sincroniza abonamentul Stripe.' }, { status: 500 });
  }
}
