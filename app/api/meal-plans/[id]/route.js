import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

function verifyToken(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Token JWT lipsă.', status: 401 };
  }
  try {
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    return { userId: String(decoded.userId || decoded.id || decoded.sub) };
  } catch (err) {
    return { error: `Token JWT invalid sau expirat: ${err.message}`, status: 401 };
  }
}

// GET /api/meal-plans/[id] — returnează un plan complet
export async function GET(request, { params }) {
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data, error } = await supabase
    .from('meal_plans')
    .select('*')
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

  return NextResponse.json({ mealPlan: data, client });
}

// DELETE /api/meal-plans/[id] — șterge un plan
export async function DELETE(request, { params }) {
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data: existing, error: fetchError } = await supabase
    .from('meal_plans')
    .select('id')
    .eq('id', id)
    .eq('trainer_id', auth.userId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Planul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  const { error } = await supabase.from('meal_plans').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: 'Eroare la ștergerea planului.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
