import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

// GET /api/workout-plans — list plans (trainer: all for their clients; client: own)
export async function GET(request) {
  const supabase = getSupabase();
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { searchParams } = new URL(request.url);
  const clientIdFilter = searchParams.get('clientId');
  const trainerId = Number.parseInt(String(auth.userId), 10);

  if (!auth.role || !['trainer', 'client'].includes(auth.role)) {
    return NextResponse.json({ error: 'Rol necunoscut. Acces interzis.' }, { status: 403 });
  }
  if (auth.role === 'trainer' && !Number.isFinite(trainerId)) {
    return NextResponse.json({ error: 'ID antrenor invalid.' }, { status: 401 });
  }

  let query = supabase
    .from('workout_plans')
    .select('id, client_id, created_at')
    .order('created_at', { ascending: false });

  if (auth.role === 'trainer') {
    query = query.eq('trainer_id', trainerId);
    if (clientIdFilter) {
      query = query.eq('client_id', clientIdFilter);
    }
  } else {
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', auth.userId)
      .single();
    if (clientErr || !client) {
      return NextResponse.json({ error: 'Client negăsit.' }, { status: 404 });
    }
    query = query.eq('client_id', client.id);
    if (clientIdFilter && clientIdFilter !== client.id) {
      return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error('GET workout_plans error:', error);
    return NextResponse.json({ error: 'Eroare la încărcarea planurilor.' }, { status: 500 });
  }

  if (auth.role === 'trainer') {
    // Latest plan per client
    const latestPerClient = {};
    for (const row of data) {
      if (!latestPerClient[row.client_id]) {
        latestPerClient[row.client_id] = { planId: row.id, createdAt: row.created_at };
      }
    }
    const res = NextResponse.json({ plans: latestPerClient });
    res.headers.set('Cache-Control', 'no-store, max-age=0');
    res.headers.set('Pragma', 'no-cache');
    return res;
  }

  const res = NextResponse.json({ plans: data });
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  res.headers.set('Pragma', 'no-cache');
  return res;
}
