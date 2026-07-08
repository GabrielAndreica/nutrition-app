import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

function isClientUser(role) {
  return role === 'client' || role === 'user';
}

// GET /api/workout-plans - planurile utilizatorului autentificat
export async function GET(request) {
  const supabase = getSupabase();
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const clientIdFilter = searchParams.get('clientId');

  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  if (clientIdFilter && clientIdFilter !== String(auth.userId)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('workout_plans')
    .select('id, client_id, created_at')
    .eq('client_id', auth.userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('GET workout_plans error:', error);
    return NextResponse.json({ error: 'Eroare la încărcarea planurilor.' }, { status: 500 });
  }

  const res = NextResponse.json({ plans: data || [] });
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  res.headers.set('Pragma', 'no-cache');
  return res;
}
