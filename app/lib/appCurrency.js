export const APP_COIN_REWARDS = {
  onboarding: 100,
  progress_update: 25,
  meal_day_complete: 30,
  workout_day_complete: 40,
  exercise_complete: 3,
  level_up: 75,
};

export function getCoinRewardForXpEvent(type) {
  if (type === 'onboarding') return APP_COIN_REWARDS.onboarding;
  if (type === 'progress_update') return APP_COIN_REWARDS.progress_update;
  if (type === 'meals') return APP_COIN_REWARDS.meal_day_complete;
  if (type === 'workout') return APP_COIN_REWARDS.workout_day_complete;
  if (type === 'exercise') return APP_COIN_REWARDS.exercise_complete;
  return 0;
}

export function getCoinRewardReason(type) {
  if (type === 'onboarding') return 'Onboarding finalizat';
  if (type === 'progress_update') return 'Progres trimis';
  if (type === 'meals') return 'Zi de mese finalizată';
  if (type === 'workout') return 'Antrenament finalizat';
  if (type === 'exercise') return 'Exercițiu finalizat';
  if (type === 'level_up') return 'Nivel nou atins';
  return 'Recompensă';
}

export async function awardAppCoins({
  supabase,
  userId,
  amount,
  reason,
  sourceType = null,
  sourceKey = null,
  metadata = {},
}) {
  const safeAmount = Math.trunc(Number(amount) || 0);
  if (!supabase || !userId || safeAmount === 0) {
    return { amountAwarded: 0, balance: null, transactionId: null };
  }

  const { data, error } = await supabase.rpc('award_app_coins', {
    p_user_id: Number(userId),
    p_amount: safeAmount,
    p_reason: reason || 'Recompensă',
    p_source_type: sourceType,
    p_source_key: sourceKey,
    p_metadata: metadata || {},
  });

  if (error) {
    console.error('[appCurrency] award failed:', error);
    return { amountAwarded: 0, balance: null, transactionId: null, error };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    amountAwarded: Number(row?.amount_awarded) || 0,
    balance: Number.isFinite(Number(row?.balance)) ? Number(row.balance) : null,
    transactionId: row?.transaction_id || null,
  };
}
