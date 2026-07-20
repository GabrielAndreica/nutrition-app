import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { getStripe, getStripePriceId } from '@/app/lib/stripe';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import {
  readLimitedJsonBody,
  requestBodyExceedsLimit,
  payloadTooLargeResponse,
} from '@/app/lib/billingRequestLimits';

export const runtime = 'nodejs';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://trevano.app';
const VALID_PLANS = new Set(['coach', 'starter', 'pro']);
const PRICE_ENV_BY_PLAN = {
  coach: 'STRIPE_COACH_PRICE_ID',
  starter: 'STRIPE_STARTER_PRICE_ID',
  pro: 'STRIPE_PRO_PRICE_ID',
};
const CHECKOUT_LEGAL_FLOW_VERSION = '2026-07-20';

function isMissingStripeResource(error) {
  return error?.statusCode === 404 || /No such/i.test(error?.message || '');
}

export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { ip, userAgent } = getRequestMeta(request);

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'stripe-create-checkout-session',
    maxRequests: 10,
    windowMinutes: 10,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  if (requestBodyExceedsLimit(request, 8 * 1024)) {
    return payloadTooLargeResponse();
  }

  let body;
  try {
    const parsedBody = await readLimitedJsonBody(request);
    if (parsedBody.tooLarge) return payloadTooLargeResponse();
    body = parsedBody.body;
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const planType = String(body?.planType || '').toLowerCase();
  if (!VALID_PLANS.has(planType)) {
    await logActivity({
      action: 'billing.checkout_create',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'invalid_plan', planType },
    });
    return NextResponse.json({ error: 'Plan invalid.' }, { status: 400 });
  }

  const priceId = getStripePriceId(planType);
  if (!priceId) {
    await logActivity({
      action: 'billing.checkout_create',
      status: 'error',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'missing_price_id', planType, envVar: PRICE_ENV_BY_PLAN[planType] },
    });
    return NextResponse.json({
      error: `Lipsește variabila ${PRICE_ENV_BY_PLAN[planType]} din .env.local.`,
    }, { status: 500 });
  }

  const supabase = getSupabase();
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, name, email, role, stripe_customer_id')
    .eq('id', auth.userId)
    .single();

  if (userError || !user) {
    await logActivity({
      action: 'billing.checkout_create',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'user_not_found', planType },
    });
    return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 });
  }

  if (user.role !== 'user' && user.role !== 'client') {
    await logActivity({
      action: 'billing.checkout_create',
      status: 'blocked',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { reason: 'non_b2c_role', planType, role: user.role },
    });
    return NextResponse.json({ error: 'Acest cont nu poate activa abonamente B2C.' }, { status: 403 });
  }

  try {
    const stripe = getStripe();
    let customerId = user.stripe_customer_id;
    const legalFlowMetadata = {
      checkoutLegalFlowVersion: CHECKOUT_LEGAL_FLOW_VERSION,
    };

    if (customerId) {
      try {
        const existingCustomer = await stripe.customers.retrieve(customerId);
        if (existingCustomer?.deleted) {
          customerId = null;
        }
      } catch (error) {
        if (!isMissingStripeResource(error)) throw error;
        await logActivity({
          action: 'billing.customer_recreate_needed',
          status: 'info',
          userId: user.id,
          email: user.email,
          ipAddress: ip,
          userAgent,
          details: { oldCustomerId: customerId, reason: error.message },
        });
        customerId = null;
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: String(user.id),
          ...legalFlowMetadata,
        },
      });

      customerId = customer.id;

      const { error: updateError } = await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);

      if (updateError) {
        await logActivity({
          action: 'billing.customer_create',
          status: 'error',
          userId: user.id,
          email: user.email,
          ipAddress: ip,
          userAgent,
          details: { customerId, error: updateError.message },
        });
        return NextResponse.json({ error: 'Nu am putut salva clientul Stripe.' }, { status: 500 });
      }

      await logActivity({
        action: 'billing.customer_create',
        status: 'success',
        userId: user.id,
        email: user.email,
        ipAddress: ip,
        userAgent,
        details: { customerId, source: user.stripe_customer_id ? 'recreated' : 'new' },
      });
    }

    await stripe.customers.update(customerId, {
      metadata: {
        userId: String(user.id),
        ...legalFlowMetadata,
      },
    });

    try {
      const price = await stripe.prices.retrieve(priceId);
      if (!price?.active) {
        await logActivity({
          action: 'billing.checkout_create',
          status: 'error',
          userId: user.id,
          email: user.email,
          ipAddress: ip,
          userAgent,
          details: { reason: 'inactive_price', planType, priceId },
        });
        return NextResponse.json({ error: 'Prețul Stripe pentru acest plan este inactiv.' }, { status: 500 });
      }
    } catch (error) {
      if (!isMissingStripeResource(error)) throw error;
      await logActivity({
        action: 'billing.checkout_create',
        status: 'error',
        userId: user.id,
        email: user.email,
        ipAddress: ip,
        userAgent,
        details: { reason: 'price_not_found_for_current_stripe_mode', planType, priceId, error: error.message },
      });
      return NextResponse.json({
          error: 'Price ID Stripe invalid pentru modul curent. Verifică STRIPE_COACH_PRICE_ID pe VPS.',
      }, { status: 500 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customerId,
      billing_address_collection: 'required',
      customer_update: {
        address: 'auto',
        name: 'auto',
      },
      phone_number_collection: {
        enabled: true,
      },
      tax_id_collection: {
        enabled: true,
      },
      consent_collection: {
        terms_of_service: 'required',
      },
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${APP_URL}/client/dashboard?tab=progress&payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/upgrade?payment=cancelled`,
      locale: 'ro',
      metadata: {
        userId: String(auth.userId),
        planType,
        ...legalFlowMetadata,
      },
      subscription_data: {
        metadata: {
          userId: String(auth.userId),
          planType,
          ...legalFlowMetadata,
        },
      },
    });

    await logActivity({
      action: 'billing.checkout_create',
      status: 'success',
      userId: user.id,
      email: user.email,
      ipAddress: ip,
      userAgent,
      details: { planType, sessionId: session.id, customerId },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('[stripe:create-checkout-session]', error);
    await logActivity({
      action: 'billing.checkout_create',
      status: 'error',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { planType, error: error.message },
    });
    return NextResponse.json({ error: 'Nu am putut crea sesiunea de plată.' }, { status: 500 });
  }
}
