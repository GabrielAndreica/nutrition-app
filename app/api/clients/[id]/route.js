import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/clients/[id] — get a single client
export async function GET(request, { params }) {
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .eq('trainer_id', auth.userId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Clientul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  return NextResponse.json({ client: data });
}

// PUT /api/clients/[id] — update a client
export async function PUT(request, { params }) {
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const { name, age, weight, height, goal, gender, activityLevel, dietType, allergies, mealsPerDay } = body;

  const missing = [];
  if (!name)   missing.push('nume');
  if (!age)    missing.push('vârstă');
  if (!weight) missing.push('greutate');
  if (!height) missing.push('înălțime');
  if (missing.length) {
    return NextResponse.json({ error: `Câmpuri obligatorii lipsă: ${missing.join(', ')}.` }, { status: 400 });
  }

  // Ensure client belongs to the logged-in user
  const { data: existing, error: fetchError } = await supabase
    .from('clients')
    .select('id')
    .eq('id', id)
    .eq('trainer_id', auth.userId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Clientul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('clients')
    .update({
      name,
      age: parseInt(age),
      weight: parseFloat(weight),
      height: parseFloat(height),
      goal: goal || 'maintenance',
      gender: gender || 'M',
      activity_level: activityLevel || 'moderate',
      diet_type: dietType || 'omnivore',
      allergies: allergies || null,
      meals_per_day: parseInt(mealsPerDay) || 3,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Supabase PUT client error:', error);
    return NextResponse.json({ error: 'Eroare la actualizarea clientului.' }, { status: 500 });
  }

  return NextResponse.json({ client: data });
}

// DELETE /api/clients/[id] — delete a client
export async function DELETE(request, { params }) {
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data: existing, error: fetchError } = await supabase
    .from('clients')
    .select('id')
    .eq('id', id)
    .eq('trainer_id', auth.userId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Clientul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Supabase DELETE client error:', error);
    return NextResponse.json({ error: 'Eroare la ștergerea clientului.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
