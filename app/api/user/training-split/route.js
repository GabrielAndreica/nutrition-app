import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';

/**
 * Computes the recommended training split based on fitness level and workouts per week.
 *
 * Rules:
 *  - Beginner  → Full Body (regardless of workouts/week)
 *  - Intermediate / Advanced:
 *      ≤ 2 workouts/week → Full Body
 *      3 workouts/week  → Push/Pull/Legs
 *      4 workouts/week  → Upper/Lower
 *      5 workouts/week  → Push/Pull/Legs (5-day PPL rotation)
 *      6+ workouts/week → Bro Split
 */
function computeTrainingSplit(fitnessLevel, workoutsPerWeek) {
  const level = String(fitnessLevel || 'beginner').toLowerCase().trim();
  const workouts = Math.max(1, Number(workoutsPerWeek) || 3);

  if (level === 'beginner') return 'Full Body';

  // intermediate or advanced
  if (workouts <= 2) return 'Full Body';
  if (workouts === 3) return 'Push/Pull/Legs';
  if (workouts === 4) return 'Upper/Lower';
  if (workouts === 5) return 'Upper/Lower/Push/Pull/Legs'; // 5-day ULPPL: Upper, Lower, Push, Pull, Legs
  return 'Bro Split'; // 6+
}

/**
 * PATCH /api/user/training-split
 * Auto-calculates and saves the recommended training_split for the logged-in user
 * based on their existing fitness_level and workouts_per_week profile data.
 * Called client-side on first "Începe" click from the dashboard.
 */
export async function PATCH(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== 'user' && auth.role !== 'client') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const supabase = getSupabase();

  // Fetch user's current fitness profile
  const { data: userRow, error: fetchError } = await supabase
    .from('users')
    .select('fitness_level, workouts_per_week, training_split')
    .eq('id', auth.userId)
    .single();

  if (fetchError || !userRow) {
    return NextResponse.json({ error: 'Profilul nu a fost găsit.' }, { status: 404 });
  }

  const recommendedSplit = computeTrainingSplit(
    userRow.fitness_level,
    userRow.workouts_per_week
  );

  // Skip write if the stored split already matches
  if (userRow.training_split === recommendedSplit) {
    return NextResponse.json({ trainingSplit: recommendedSplit, changed: false });
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ training_split: recommendedSplit })
    .eq('id', auth.userId);

  if (updateError) {
    console.error('[training-split] update error:', updateError);
    return NextResponse.json({ error: 'Eroare la actualizarea profilului.' }, { status: 500 });
  }

  return NextResponse.json({ trainingSplit: recommendedSplit, changed: true });
}

/**
 * GET /api/user/training-split
 * Returns the user's current training_split and workouts_per_week from DB.
 * Used by the client dashboard to compute the weekly schedule display.
 */
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== 'user' && auth.role !== 'client') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const supabase = getSupabase();
  const { data: userRow, error: fetchError } = await supabase
    .from('users')
    .select('training_split, workouts_per_week')
    .eq('id', auth.userId)
    .single();

  if (fetchError || !userRow) {
    return NextResponse.json({ error: 'Profilul nu a fost g\u0103sit.' }, { status: 404 });
  }

  return NextResponse.json({
    trainingSplit: userRow.training_split || 'Full Body',
    workoutsPerWeek: userRow.workouts_per_week || 3,
  });
}
