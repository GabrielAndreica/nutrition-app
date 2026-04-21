import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

// GET /api/clients/progress-status
// Returnează doar {id, has_new_progress} pentru toți clienții trainerului.
// Endpoint lightweight folosit de polling (15s) pentru badge live.
export async function GET(request) {
  const supabase = getSupabase();
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
