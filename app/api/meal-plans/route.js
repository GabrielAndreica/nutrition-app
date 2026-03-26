import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/meal-plans — returnează cel mai recent plan per client pentru trainerul autentificat
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data, error } = await supabase
    .from('meal_plans')
    .select('id, client_id, created_at')
    .eq('trainer_id', auth.userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase GET meal_plans error:', error);
    return NextResponse.json({ error: 'Eroare la încărcarea planurilor.' }, { status: 500 });
  }

  // Păstrează doar cel mai recent plan per client
  const latestPerClient = {};
  for (const row of data) {
    if (!latestPerClient[row.client_id]) {
      latestPerClient[row.client_id] = { planId: row.id, createdAt: row.created_at };
    }
  }

  return NextResponse.json({ plans: latestPerClient });
}
