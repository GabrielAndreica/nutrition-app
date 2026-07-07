export async function resolveUserOnboardingCompletion(supabase, userId) {
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('onboarding_completed, age, weight, height, gender, fitness_level, workouts_per_week, fitness_goal, goal')
    .eq('id', userId)
    .maybeSingle();

  if (userError || !userRow) return false;
  if (userRow.onboarding_completed === true) return true;

  const hasProfile =
    !!userRow.age &&
    !!userRow.weight &&
    !!userRow.height &&
    !!userRow.gender &&
    !!userRow.fitness_level &&
    !!userRow.workouts_per_week &&
    !!(userRow.fitness_goal || userRow.goal);

  let completed = hasProfile;

  if (!completed) {
    const [mealPlanResult, workoutPlanResult] = await Promise.all([
      supabase
        .from('meal_plans')
        .select('id')
        .eq('client_id', userId)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('workout_plans')
        .select('id')
        .eq('client_id', userId)
        .limit(1)
        .maybeSingle(),
    ]);

    completed = !!mealPlanResult.data || !!workoutPlanResult.data;
  }

  if (completed) {
    await supabase
      .from('users')
      .update({ onboarding_completed: true })
      .eq('id', userId);
  }

  return completed;
}
