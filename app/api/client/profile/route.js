import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/client/profile — returnează datele clientului autentificat
export async function GET(request) {
  const user = await verifyToken(request);

  if (!user || user.role !== 'client') {
    return NextResponse.json({ error: 'Neautorizat.' }, { status: 401 });
  }

  try {
    // Găsește clientul după user_id
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client negăsit.' }, { status: 404 });
    }

    // Încarcă planurile alimentare
    const { data: mealPlans, error: plansError } = await supabase
      .from('meal_plans')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false });

    if (plansError) {
      console.error('Eroare la încărcarea planurilor:', plansError);
    }

    return NextResponse.json({
      client,
      mealPlans: mealPlans || [],
    });
  } catch (err) {
    console.error('Eroare la încărcarea profilului:', err);
    return NextResponse.json({ error: 'Eroare server.' }, { status: 500 });
  }
}
