import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

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

  const { ip, userAgent } = getRequestMeta(request);
  logActivity({
    action: 'client.view',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { clientId: id, clientName: data.name },
  });
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

  const { ip, userAgent } = getRequestMeta(request);
  if (error) {
    console.error('Supabase PUT client error:', error);
    logActivity({
      action: 'client.update',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { clientId: id, error: error.message },
    });
    return NextResponse.json({ error: 'Eroare la actualizarea clientului.' }, { status: 500 });
  }

  logActivity({
    action: 'client.update',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { clientId: id, clientName: data.name },
  });
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

  const { ip, userAgent } = getRequestMeta(request);
  if (error) {
    console.error('Supabase DELETE client error:', error);
    logActivity({
      action: 'client.delete',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { clientId: id, error: error.message },
    });
    return NextResponse.json({ error: 'Eroare la ștergerea clientului.' }, { status: 500 });
  }

  logActivity({
    action: 'client.delete',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { clientId: id },
  });
  return NextResponse.json({ success: true });
}
