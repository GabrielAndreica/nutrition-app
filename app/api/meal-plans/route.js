import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

// GET /api/meal-plans — returnează planuri (toate pentru trainer, doar ale sale pentru client)
export async function GET(request) {
  const supabase = getSupabase();
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Construiește query-ul bazat pe rol
  if (!auth.role || !['trainer', 'client'].includes(auth.role)) {
    return NextResponse.json({ error: 'Rol necunoscut. Acces interzis.' }, { status: 403 });
  }

  let query = supabase
    .from('meal_plans')
    .select('id, client_id, created_at')
    .order('created_at', { ascending: false });

  // Dacă e trainer, returnează planurile clienților săi
  if (auth.role === 'trainer') {
    query = query.eq('trainer_id', auth.userId);
  }
  // Dacă e client, returnează doar planurile sale
  else if (auth.role === 'client') {
    // Obține client_id pentru user
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', auth.userId)
      .single();

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client negăsit.' }, { status: 404 });
    }

    query = query.eq('client_id', client.id);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Supabase GET meal_plans error:', error);
    return NextResponse.json({ error: 'Eroare la încărcarea planurilor.' }, { status: 500 });
  }

  // Pentru trainer: păstrează doar cel mai recent plan per client
  // Pentru client: returnează toate planurile sale
  if (auth.role === 'trainer') {
    const latestPerClient = {};
    for (const row of data) {
      if (!latestPerClient[row.client_id]) {
        latestPerClient[row.client_id] = { planId: row.id, createdAt: row.created_at };
      }
    }
    return NextResponse.json({ plans: latestPerClient });
  } else {
    // Pentru client, returnează array direct
    return NextResponse.json({ plans: data });
  }
}
