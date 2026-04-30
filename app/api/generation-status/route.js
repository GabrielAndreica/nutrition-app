import { NextResponse } from 'next/server';
import { getSupabase, supabaseQuery } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

/**
 * GET /api/generation-status
 * Returnează toate generările active pentru trainer-ul curent
 */
export async function GET(request) {
  const supabase = getSupabase();
  try {
    const auth = verifyToken(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const trainerId = auth.userId;

    // Curăță automat generările blocate (>5 min fără update)
    const thirtyMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await supabaseQuery(() => supabase
      .from('generation_status')
      .update({ status: 'failed', error_message: 'Timeout - generarea a durat prea mult', completed_at: new Date().toISOString() })
      .eq('trainer_id', trainerId)
      .eq('status', 'generating')
      .lt('updated_at', thirtyMinutesAgo));

    // Obține toate generările active
    const { data: generations, error } = await supabaseQuery(() => supabase
      .from('generation_status')
      .select('*')
      .eq('trainer_id', trainerId)
      .eq('status', 'generating')
      .order('started_at', { ascending: false }));

    if (error) {
      console.error('Error fetching generation status:', error);
      return NextResponse.json(
        { error: 'Eroare la obținerea statusului' },
        { status: 500 }
      );
    }

    return NextResponse.json({ generations: generations || [] });
  } catch (error) {
    console.error('Error in generation-status GET:', error);
    return NextResponse.json(
      { error: 'Eroare internă' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/generation-status
 * Creează sau actualizează statusul generării
 */
export async function POST(request) {
  const supabase = getSupabase();
  try {
    const auth = verifyToken(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const trainerId = auth.userId;
    const body = await request.json();
    const { clientId, status, currentStep, errorMessage, planId } = body;

    if (!clientId || !status) {
      return NextResponse.json(
        { error: 'clientId și status sunt obligatorii' },
        { status: 400 }
      );
    }

    // Upsert (insert sau update)
    const updateData = {
      client_id: clientId,
      trainer_id: trainerId,
      status,
      current_step: currentStep || 0,
      total_steps: 7,
    };

    if (errorMessage) updateData.error_message = errorMessage;
    if (planId) updateData.plan_id = planId;
    if (status === 'completed' || status === 'failed') {
      updateData.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabaseQuery(() => supabase
      .from('generation_status')
      .upsert(updateData, {
        onConflict: 'client_id,trainer_id',
        returning: 'minimal'
      }));

    if (error) {
      console.error('Error updating generation status:', error);
      return NextResponse.json(
        { error: 'Eroare la actualizarea statusului' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in generation-status POST:', error);
    return NextResponse.json(
      { error: 'Eroare internă' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/generation-status?clientId=xxx
 * Șterge statusul generării pentru un client
 */
export async function DELETE(request) {
  const supabase = getSupabase();
  try {
    const auth = verifyToken(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const trainerId = auth.userId;
    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId');

    if (!clientId) {
      return NextResponse.json(
        { error: 'clientId este obligatoriu' },
        { status: 400 }
      );
    }

    const { error } = await supabaseQuery(() => supabase
      .from('generation_status')
      .delete()
      .eq('client_id', clientId)
      .eq('trainer_id', trainerId));

    if (error) {
      console.error('Error deleting generation status:', error);
      return NextResponse.json(
        { error: 'Eroare la ștergerea statusului' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in generation-status DELETE:', error);
    return NextResponse.json(
      { error: 'Eroare internă' },
      { status: 500 }
    );
  }
}
