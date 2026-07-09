import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { createAutomaticMealPlanForUser } from '@/app/lib/automaticMealPlan';
import { calculateHydrationTargetMl } from '@/app/lib/hydrationTarget';

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== 'user' && auth.role !== 'client') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const supabase = getSupabase();

  // Obține profilul utilizatorului direct din users
  let { data: clientRow, error: clientError } = await supabase
    .from('users')
    .select('id, name, age, weight, height, gender, fitness_level, available_equipment, workouts_per_week, training_split, fitness_goal, goal, activity_level, diet_type, meals_per_day, hydration_target_ml, food_preferences, allergies')
    .eq('id', auth.userId)
    .maybeSingle();

  if (clientError || !clientRow) {
    return NextResponse.json({ error: 'Profilul nu a fost găsit. Completă onboarding-ul.' }, { status: 404 });
  }

  if (!Number(clientRow.hydration_target_ml)) {
    const hydrationTargetMl = calculateHydrationTargetMl({
      weight: clientRow.weight,
      activityLevel: clientRow.activity_level,
      goal: clientRow.goal || clientRow.fitness_goal,
    });

    const { data: updatedHydration } = await supabase
      .from('users')
      .update({ hydration_target_ml: hydrationTargetMl })
      .eq('id', auth.userId)
      .select('hydration_target_ml')
      .maybeSingle();

    clientRow = {
      ...clientRow,
      hydration_target_ml: updatedHydration?.hydration_target_ml || hydrationTargetMl,
    };
  }

  const clientId = auth.userId;

  // Obține cel mai recent plan alimentar
  let { data: mealPlan } = await supabase
    .from('meal_plans')
    .select('id, plan_data, daily_targets, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let mealPlanWarning = null;
  if (!mealPlan) {
    try {
      const generated = await createAutomaticMealPlanForUser({
        supabase,
        userId: clientId,
        profile: {
          name: clientRow.name,
          age: clientRow.age,
          weight: clientRow.weight,
          height: clientRow.height,
          gender: clientRow.gender,
          goal: clientRow.goal,
          activityLevel: clientRow.activity_level,
          dietType: clientRow.diet_type,
          allergies: clientRow.allergies,
          foodPreferences: clientRow.food_preferences,
        },
      });
      if (generated?.mealPlanId) {
        const { data: generatedMealPlan } = await supabase
          .from('meal_plans')
          .select('id, plan_data, daily_targets, created_at')
          .eq('id', generated.mealPlanId)
          .maybeSingle();
        mealPlan = generatedMealPlan || null;
      }
    } catch (error) {
      mealPlanWarning = error?.message || 'Planul alimentar automat nu a putut fi generat.';
      console.error('[user/plans] automatic meal plan error:', error);
    }
  }

  // Obține cel mai recent plan de antrenament
  const { data: workoutPlan } = await supabase
    .from('workout_plans')
    .select('id, plan_data, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    client: clientRow,
    mealPlan: mealPlan || null,
    workoutPlan: workoutPlan || null,
    mealPlanWarning,
  });
}
