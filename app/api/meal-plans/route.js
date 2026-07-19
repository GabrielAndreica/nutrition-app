import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

function isClientUser(role) {
  return role === 'client' || role === 'user';
}

// GET /api/meal-plans - planurile utilizatorului autentificat
export async function GET(request) {
  const supabase = getSupabase();
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'meal-plans-list',
    maxRequests: 90,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  const { searchParams } = new URL(request.url);
  const clientIdFilter = searchParams.get('clientId');
  if (clientIdFilter && clientIdFilter !== String(auth.userId)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('meal_plans')
    .select('id, client_id, created_at')
    .eq('client_id', auth.userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase GET meal_plans error:', error);
    return NextResponse.json({ error: 'Eroare la încărcarea planurilor.' }, { status: 500 });
  }

  return NextResponse.json({ plans: data || [] });
}
