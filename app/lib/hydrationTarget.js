export function calculateHydrationTargetMl({ weight, activityLevel, goal } = {}) {
  const weightKg = Number(weight);
  const safeWeight = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : 70;

  const activityBonus = {
    sedentary: 0,
    light: 250,
    moderate: 500,
    active: 750,
    very_active: 1000,
  };

  const goalBonus = {
    weight_loss: 250,
    muscle_gain: 250,
    maintenance: 0,
    endurance: 500,
    flexibility: 0,
  };

  const rawTarget =
    safeWeight * 35 +
    (activityBonus[activityLevel] || 0) +
    (goalBonus[goal] || 0);

  const rounded = Math.round(rawTarget / 250) * 250;
  return Math.max(1500, Math.min(5000, rounded));
}
