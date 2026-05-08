import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { getStripe, getPlanTypeFromPriceId } from '@/app/lib/stripe';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function stripeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id || null;
}

async function getPlanFromCheckoutSession(stripe, session) {
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 1,
    expand: ['data.price'],
  });

  const priceId = lineItems.data?.[0]?.price?.id;
  return getPlanTypeFromPriceId(priceId);
}

function getPlanFromSubscription(subscription) {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  return getPlanTypeFromPriceId(priceId);
}

async function updateUserByCustomer(customerId, updates) {
  if (!customerId) return { error: new Error('Missing Stripe customer ID') };
  return getSupabase()
    .from('users')
    .update(updates)
    .eq('stripe_customer_id', customerId)
    .select('id, email, subscription_status, subscription_plan')
    .maybeSingle();
}

export async function POST(request) {
  const { ip, userAgent } = getRequestMeta(request);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret lipsă.' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Semnătură Stripe lipsă.' }, { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = getStripe();
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('[stripe:webhook] invalid signature', err.message);
    await logActivity({
      action: 'stripe.webhook',
      status: 'blocked',
      ipAddress: ip,
      userAgent,
      details: { reason: 'invalid_signature', error: err.message },
    });
    return NextResponse.json({ error: 'Semnătură Stripe invalidă.' }, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const verifiedPlanType = await getPlanFromCheckoutSession(stripe, session);
      const userId = session.metadata?.userId;

      if (!userId || !verifiedPlanType) {
        console.error('[stripe:webhook] checkout.session.completed missing verified user/plan', {
          sessionId: session.id,
          userId,
          metadataPlanType: session.metadata?.planType,
        });
        return NextResponse.json({ received: true });
      }

      const subscriptionId = stripeId(session.subscription);
      const customerId = stripeId(session.customer);

      const { error } = await getSupabase()
        .from('users')
        .update({
          subscription_status: 'active',
          subscription_id: subscriptionId,
          subscribed_at: new Date().toISOString(),
          subscription_plan: verifiedPlanType,
          plan: verifiedPlanType,
          stripe_customer_id: customerId,
        })
        .eq('id', userId);

      if (error) throw error;

      await logActivity({
        action: 'billing.subscription_activated',
        status: 'success',
        userId,
        ipAddress: ip,
        userAgent,
        details: {
          source: 'stripe_webhook',
          eventId: event.id,
          sessionId: session.id,
          customerId,
          subscriptionId,
          planType: verifiedPlanType,
        },
      });
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = stripeId(subscription.customer);

      const { data: user, error } = await updateUserByCustomer(customerId, {
        subscription_status: 'cancelled',
        subscription_id: null,
      });

      if (error) throw error;

      await logActivity({
        action: 'billing.subscription_cancelled',
        status: 'success',
        userId: user?.id || null,
        email: user?.email || null,
        ipAddress: ip,
        userAgent,
        details: {
          source: 'stripe_webhook',
          eventId: event.id,
          customerId,
          subscriptionId: subscription.id,
        },
      });
    }

    if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const customerId = stripeId(subscription.customer);
      const verifiedPlanType = getPlanFromSubscription(subscription);
      const updates = {};

      if (subscription.status === 'active') {
        updates.subscription_status = 'active';
      }

      if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
        updates.subscription_status = 'expired';
      }

      if (verifiedPlanType) {
        updates.subscription_plan = verifiedPlanType;
        updates.plan = verifiedPlanType;
      }

      if (Object.keys(updates).length > 0) {
        const { data: user, error } = await updateUserByCustomer(customerId, updates);
        if (error) throw error;

        await logActivity({
          action: 'billing.subscription_updated',
          status: 'success',
          userId: user?.id || null,
          email: user?.email || null,
          ipAddress: ip,
          userAgent,
          details: {
            source: 'stripe_webhook',
            eventId: event.id,
            customerId,
            subscriptionId: subscription.id,
            stripeStatus: subscription.status,
            updates,
          },
        });
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const customerId = stripeId(invoice.customer);

      const { data: user, error } = await updateUserByCustomer(customerId, {
        subscription_status: 'expired',
      });

      if (error) throw error;
      await logActivity({
        action: 'billing.payment_failed',
        status: 'success',
        userId: user?.id || null,
        email: user?.email || null,
        ipAddress: ip,
        userAgent,
        details: {
          source: 'stripe_webhook',
          eventId: event.id,
          invoiceId: invoice.id,
          customerId,
        },
      });
      console.warn('[stripe:webhook] invoice.payment_failed', {
        invoiceId: invoice.id,
        customerId,
      });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[stripe:webhook] handler failed', err);
    await logActivity({
      action: 'stripe.webhook',
      status: 'error',
      ipAddress: ip,
      userAgent,
      details: { eventId: event?.id || null, eventType: event?.type || null, error: err.message },
    });
    return NextResponse.json({ error: 'Webhook processing failed.' }, { status: 500 });
  }
}
