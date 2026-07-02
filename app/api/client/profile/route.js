import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

// GET /api/client/profile — returnează datele clientului autentificat
export async function GET(request) {
  const supabase = getSupabase();
  const user = await verifyToken(request);

  if (!user || (user.role !== 'client' && user.role !== 'user')) {
    return NextResponse.json({ error: 'Neautorizat.' }, { status: 401 });
  }

  const userId = user.userId || user.id;

  try {
    // Găsește utilizatorul în tabela users
    const { data: client, error: clientError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (clientError || !client) {
      return NextResponse.json({ error: 'Utilizator negăsit.' }, { status: 404 });
    }

    // Încarcă planurile alimentare
    const { data: mealPlans, error: plansError } = await supabase
      .from('meal_plans')
      .select('*')
      .eq('client_id', userId)
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
