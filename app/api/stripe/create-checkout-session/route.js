import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { getStripe, getStripePriceId } from '@/app/lib/stripe';

export const runtime = 'nodejs';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://trevano.app';
const VALID_PLANS = new Set(['starter', 'pro']);
const PRICE_ENV_BY_PLAN = {
  starter: 'STRIPE_STARTER_PRICE_ID',
  pro: 'STRIPE_PRO_PRICE_ID',
};

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

  const planType = String(body?.planType || '').toLowerCase();
  if (!VALID_PLANS.has(planType)) {
    return NextResponse.json({ error: 'Plan invalid.' }, { status: 400 });
  }

  const priceId = getStripePriceId(planType);
  if (!priceId) {
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
    return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 });
  }

  if (user.role !== 'trainer') {
    return NextResponse.json({ error: 'Doar antrenorii pot activa abonamente.' }, { status: 403 });
  }

  try {
    const stripe = getStripe();
    let customerId = user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: String(user.id),
        },
      });

      customerId = customer.id;

      const { error: updateError } = await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);

      if (updateError) {
        return NextResponse.json({ error: 'Nu am putut salva clientul Stripe.' }, { status: 500 });
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${APP_URL}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/upgrade?payment=cancelled`,
      locale: 'ro',
      metadata: {
        userId: String(auth.userId),
        planType,
      },
      subscription_data: {
        metadata: {
          userId: String(auth.userId),
          planType,
        },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('[stripe:create-checkout-session]', error);
    return NextResponse.json({ error: 'Nu am putut crea sesiunea de plată.' }, { status: 500 });
  }
}
