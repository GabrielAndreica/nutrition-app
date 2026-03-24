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
    return { error: 'Token JWT lipsă. Autentificare necesară.', status: 401 };
  }
  try {
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
    return { userId: decoded.userId || decoded.id || decoded.sub };
  } catch (err) {
    return { error: `Token JWT invalid sau expirat: ${err.message}`, status: 401 };
  }
}

// GET /api/clients — list all clients for the logged-in user
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('trainer_id', auth.userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase GET clients error:', error);
    return NextResponse.json({ error: 'Eroare la încărcarea clienților.' }, { status: 500 });
  }

  return NextResponse.json({ clients: data });
}

// POST /api/clients — create a new client
export async function POST(request) {
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
  if (!name)          missing.push('nume');
  if (!age)           missing.push('vârstă');
  if (!weight)        missing.push('greutate');
  if (!height)        missing.push('înălțime');
  if (missing.length) {
    return NextResponse.json({ error: `Câmpuri obligatorii lipsă: ${missing.join(', ')}.` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('clients')
    .insert([{
      trainer_id: auth.userId,
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
    }])
    .select()
    .single();

  if (error) {
    console.error('Supabase POST client error:', error);
    return NextResponse.json({ error: 'Eroare la salvarea clientului.' }, { status: 500 });
  }

  return NextResponse.json({ client: data }, { status: 201 });
}
