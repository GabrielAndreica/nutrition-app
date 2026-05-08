import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { getStripe } from '@/app/lib/stripe';

export const runtime = 'nodejs';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://trevano.app';

export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getSupabase();
  const { data: user, error } = await supabase
    .from('users')
    .select('stripe_customer_id, role')
    .eq('id', auth.userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'Utilizatorul nu a fost găsit.' }, { status: 404 });
  }

  if (user.role !== 'trainer') {
    return NextResponse.json({ error: 'Doar antrenorii pot gestiona abonamente.' }, { status: 403 });
  }

  if (!user.stripe_customer_id) {
    return NextResponse.json({ error: 'Nu există un client Stripe pentru acest cont.' }, { status: 400 });
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${APP_URL}/dashboard`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('[stripe:create-portal-session]', err);
    return NextResponse.json({ error: 'Nu am putut deschide portalul de billing.' }, { status: 500 });
  }
}
