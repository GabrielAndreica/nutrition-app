import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GET /api/clients/progress-status
// Returnează doar {id, has_new_progress} pentru toți clienții trainerului.
// Endpoint lightweight folosit de polling (15s) pentru badge live.
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'trainer') return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });

  const { data, error } = await supabase
    .from('clients')
    .select('id, has_new_progress')
    .eq('trainer_id', auth.userId);

  if (error) {
    console.error('[progress-status] error:', error);
    return NextResponse.json({ error: 'Eroare.' }, { status: 500 });
  }

  return NextResponse.json({ statuses: data || [] });
}
