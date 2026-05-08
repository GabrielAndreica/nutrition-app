import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { reserveMonthlyClientUsage } from '@/app/lib/clientUsage';

export const dynamic = 'force-dynamic';

const ALLOWED_REASONS = new Set([
  'meal_plan_pdf_export',
  'workout_plan_pdf_export',
]);

export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (auth.role !== 'trainer') {
    return NextResponse.json({ error: 'Doar antrenorii pot consuma locuri de client.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const clientId = String(body?.clientId || '').trim();
  const reason = String(body?.reason || '').trim();

  if (!clientId) {
    return NextResponse.json({ error: 'clientId lipsă.' }, { status: 400 });
  }

  if (!ALLOWED_REASONS.has(reason)) {
    return NextResponse.json({ error: 'Motiv invalid.' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('trainer_id', auth.userId)
    .is('deleted_at', null)
    .single();

  if (clientError || !client) {
    return NextResponse.json({ error: 'Clientul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  const usage = await reserveMonthlyClientUsage({
    trainerId: auth.userId,
    clientId,
    reason,
  });

  if (!usage.allowed) return usage.response;

  return NextResponse.json({
    success: true,
    counted: usage.counted,
    alreadyCounted: usage.alreadyCounted,
    usage: usage.usage,
  });
}
