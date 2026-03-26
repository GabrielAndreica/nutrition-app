import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/meal-plans/[id] — returnează un plan complet
export async function GET(request, { params }) {
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data, error } = await supabase
    .from('meal_plans')
    .select('id, client_id, plan_data, daily_targets, created_at')
    .eq('id', id)
    .eq('trainer_id', auth.userId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Planul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  // Fetch client profile from clients table
  let client = null;
  if (data.client_id) {
    const { data: clientData } = await supabase
      .from('clients')
      .select('name, age, weight, height, gender, goal, activity_level, diet_type, allergies, meals_per_day')
      .eq('id', data.client_id)
      .single();
    client = clientData || null;
  }

  const { ip, userAgent } = getRequestMeta(request);
  logActivity({
    action: 'meal_plan.view',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: {
      planId: id,
      clientId: data.client_id || null,
      clientName: client?.name || data.plan_data?.clientName || null,
    },
  });

  // Cache per-user: same trainer navigating back = instant load; stale-while-revalidate
  // serves stale content immediately while fetching fresh in background (fewer DB hits at scale)
  const res = NextResponse.json({ mealPlan: data, client });
  res.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
  res.headers.set('Vary', 'Authorization');
  return res;
}

// DELETE /api/meal-plans/[id] — șterge un plan (un singur round-trip: ownership check + delete combinate)
export async function DELETE(request, { params }) {
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // .eq('trainer_id') serveşte şi ca ownership check — dacă count=0 înseamnă not found / no access
  const { error, count } = await supabase
    .from('meal_plans')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('trainer_id', auth.userId);

  const { ip, userAgent } = getRequestMeta(request);

  if (!error && count === 0) {
    return NextResponse.json({ error: 'Planul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  if (error) {
    logActivity({
      action: 'meal_plan.delete',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { planId: id, error: error.message },
    });
    return NextResponse.json({ error: 'Eroare la ștergerea planului.' }, { status: 500 });
  }

  logActivity({
    action: 'meal_plan.delete',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { planId: id },
  });
  return NextResponse.json({ success: true });
}
