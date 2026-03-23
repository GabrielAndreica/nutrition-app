import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import jwt from 'jsonwebtoken';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('Missing auth header or Bearer prefix');
      return NextResponse.json(
        { error: 'Token JWT lipsă. Autentificare necesară.' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    console.log('Token received, attempting to verify...');

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
      console.log('Token verified successfully:', decoded);
    } catch (error) {
      console.log('Token verification failed:', error.message);
      return NextResponse.json(
        { error: `Token JWT invalid sau expirat. ${error.message}` },
        { status: 401 }
      );
    }

    const clientData = await request.json();

    if (!clientData.name || !clientData.age || !clientData.weight || !clientData.height) {
      return NextResponse.json(
        { error: 'Date lipsă: nume, vârstă, greutate și înălțime sunt obligatorii' },
        { status: 400 }
      );
    }

    const targetCalories = calculateTargetCalories(clientData);
    const weightKg = parseFloat(clientData.weight);
    const macros = calculateMacros(clientData.goal, weightKg, targetCalories);
    const proteinGrams = macros.protein;
    const carbsGrams = macros.carbs;
    const fatGrams = macros.fat;

    const { name, age, weight, height, goal, activityLevel, allergies, mealsPerDay, dietType } = clientData;
    const sex = clientData.gender === 'M' ? 'Masculin' : 'Feminin';
    const mealsNum = parseInt(mealsPerDay) || 3;

    const mealDistribution = getMealDistribution(mealsNum);
    const mealTargetsStr = Object.entries(mealDistribution)
      .map(([meal, pct]) => {
        const cal = Math.round(targetCalories * pct);
        const p   = Math.round(proteinGrams * pct);
        const c   = Math.round(carbsGrams * pct);
        const f   = Math.round(fatGrams * pct);
        return `- ${meal}: ~${cal} kcal (P:${p}g C:${c}g G:${f}g)`;
      })
      .join('\n');

    const dayNames = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
    const targets = {
      calories: Math.round(targetCalories),
      protein:  Math.round(proteinGrams),
      carbs:    Math.round(carbsGrams),
      fat:      Math.round(fatGrams),
    };

    const days = [];
    const previousFoods = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const dayNumber = dayIndex + 1;
      const dayName = dayNames[dayIndex];
      console.log(`Generare ziua ${dayNumber}/7 (${dayName})...`);

      const avoidFoodsStr = previousFoods.length > 0
        ? `\nALIMENTE DEJA FOLOSITE (evită repetarea lor ca ingrediente principale): ${previousFoods.join(', ')}`
        : '';

      const dayPrompt = `TASK: Generează mese cu alimente și gramaje astfel încât suma să fie EXACT:
- Calorii: ${targets.calories} kcal
- Proteine: ${targets.protein}g  
- Carbohidrați: ${targets.carbs}g
- Grăsimi: ${targets.fat}g

REGULA #1: Nu ai voie să reduci cantitățile pentru că "par prea mari". Dacă targetul e 3000 kcal, generezi 3000 kcal.
REGULA #2: Calculează fiecare aliment matematic. Dacă ai nevoie de 352g carbohidrați și ai deja 200g, adaugă alimente până ajungi la 352g.
REGULA #3: Valorile nutriționale per aliment TREBUIE să fie realiste per 100g:
  - Orez fiert: 130 kcal, 2.7g P, 28g C, 0.3g G per 100g
  - Piept pui fiert: 165 kcal, 31g P, 0g C, 3.6g G per 100g
  - Ouă (1 ou = 60g): 85 kcal, 7g P, 0.5g C, 6g G
  - Paste fierte: 131 kcal, 5g P, 25g C, 1g G per 100g
  - Pâine integrală: 247 kcal, 9g P, 41g C, 3.4g G per 100g
  - Banană (100g): 89 kcal, 1.1g P, 23g C, 0.3g G
  - Brânză de vaci: 98 kcal, 11g P, 3.4g C, 4g G per 100g
  - Iaurt grecesc: 97 kcal, 9g P, 3.6g C, 5g G per 100g
  - Cartofi fierți: 86 kcal, 1.7g P, 20g C, 0.1g G per 100g
  - Somon: 208 kcal, 20g P, 0g C, 13g G per 100g

CLIENT: ${name}, ${age} ani, ${sex}, ${weight}kg, ${height}cm
Ziua ${dayNumber} (${dayName}) | Dietă: ${getDietLabel(dietType)} | Alergii: ${allergies || 'Niciuna'}
${avoidFoodsStr}

DISTRIBUȚIE OBLIGATORIE PE ${mealsNum} MESE:
${mealTargetsStr}

METODĂ DE CALCUL OBLIGATORIE:
1. Pentru fiecare masă știi exact câte calorii și macros trebuie
2. Alegi alimentele și calculezi gramajele matematic
3. Verifici suma înainte să returnezi
4. Dacă suma nu e corectă, ajustezi gramajele — NU schimbi targetul

RETURNEAZĂ DOAR JSON VALID (fără markdown, fără \`\`\`, fără explicații):
{
  "day": ${dayNumber},
  "meals": [
    {
      "mealType": "Mic Dejun",
      "foods": [
        {"name":"Fulgi de ovăz","amount":100,"unit":"g","calories":390,"protein":15,"carbs":65,"fat":7},
        {"name":"Lapte 1.5%","amount":300,"unit":"ml","calories":140,"protein":10,"carbs":15,"fat":5}
      ],
      "preparation": "Fierbe fulgii în lapte 5 minute.",
      "mealTotals": {"calories":530,"protein":25,"carbs":80,"fat":12}
    }
  ],
  "dailyTotals": {"calories":${targets.calories},"protein":${targets.protein},"carbs":${targets.carbs},"fat":${targets.fat}}
}`;

      const message = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Ești un nutriționist AI precis. Returnează DOAR JSON valid pentru o singură zi. Fără markdown, fără blocuri de cod. Ziua trebuie să totalizeze ~${targets.calories} kcal cu P:${targets.protein}g C:${targets.carbs}g G:${targets.fat}g. Folosește nume de alimente în limba română.`,
          },
          {
            role: 'user',
            content: dayPrompt,
          },
        ],
        temperature: 0.5,
        max_tokens: 3000,
      });

      let content = message.choices[0].message.content;
      content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      let dayPlan;
      try {
        dayPlan = JSON.parse(content);
      } catch {
        console.error(`Day ${dayNumber}: Invalid JSON`);
        return NextResponse.json(
          { error: `Eroare la parsarea zilei ${dayNumber}. Încercați din nou.` },
          { status: 500 }
        );
      }

      recalculateDayTotals(dayPlan);
      adjustDayToTargets(dayPlan, targets);

      console.log(`Day ${dayNumber}: Done ✓ (${dayPlan.dailyTotals.calories} kcal)`);

      if (dayPlan.meals) {
        dayPlan.meals.forEach(meal => {
          if (meal.foods) {
            meal.foods.forEach(food => {
              if (food.name && !previousFoods.includes(food.name)) {
                previousFoods.push(food.name);
              }
            });
          }
        });
      }

      days.push(dayPlan);
    }

    const plan = {
      clientName: name,
      dailyTargets: targets,
      days,
    };

    return NextResponse.json({
      success: true,
      plan,
      clientData,
      nutritionalNeeds: targets,
    });
  } catch (error) {
    console.error('Error generating meal plan:', error);
    return NextResponse.json(
      {
        error: 'Eroare la generarea planului alimentar. Vă rog încercați din nou.',
        details: error.message,
      },
      { status: 500 }
    );
  }
}

// ─── Helper functions ────────────────────────────────────────────────────────

/**
 * Rotunjește gramajul alimentului la cel mai apropiat multiplu de 5
 * Ex: 126g → 125g, 128g → 130g
 * Folosit DOAR pentru food.amount, nu pentru macros
 */
function roundToNearest5(value) {
  return Math.round(value / 5) * 5;
}

function adjustDayToTargets(day, targets) {
  if (!day.meals || day.meals.length === 0) return day;

  let actualCal = 0, actualCarbs = 0, actualProtein = 0, actualFat = 0;

  day.meals.forEach(meal => {
    meal.foods.forEach(food => {
      actualCal     += food.calories || 0;
      actualCarbs   += food.carbs    || 0;
      actualProtein += food.protein  || 0;
      actualFat     += food.fat      || 0;
    });
  });

  const calFactor     = actualCal     > 0 ? targets.calories / actualCal     : 1;
  const proteinFactor = actualProtein > 0 ? targets.protein  / actualProtein : 1;
  const carbsFactor   = actualCarbs   > 0 ? targets.carbs    / actualCarbs   : 1;
  const fatFactor     = actualFat     > 0 ? targets.fat      / actualFat     : 1;

  day.meals.forEach(meal => {
    meal.foods.forEach(food => {
      // Gramajul se rotunjește la multiplu de 5
      food.amount   = roundToNearest5((food.amount   || 0) * calFactor);
      // Macros se rotunjesc normal
      food.calories = Math.round((food.calories || 0) * calFactor);
      food.protein  = Math.round((food.protein  || 0) * proteinFactor);
      food.carbs    = Math.round((food.carbs    || 0) * carbsFactor);
      food.fat      = Math.round((food.fat      || 0) * fatFactor);
    });
  });

  recalculateDayTotals(day);
  return day;
}

function recalculateDayTotals(day) {
  let dayCal = 0, dayP = 0, dayC = 0, dayF = 0;

  if (!day.meals) return;

  day.meals.forEach((meal) => {
    let mealCal = 0, mealP = 0, mealC = 0, mealF = 0;

    if (meal.foods && Array.isArray(meal.foods)) {
      meal.foods.forEach((food) => {
        mealCal += food.calories || 0;
        mealP   += food.protein  || 0;
        mealC   += food.carbs    || 0;
        mealF   += food.fat      || 0;
      });
    }

    // Totalurile meselor și zilei se rotunjesc normal
    meal.mealTotals = {
      calories: Math.round(mealCal),
      protein:  Math.round(mealP),
      carbs:    Math.round(mealC),
      fat:      Math.round(mealF),
    };

    dayCal += mealCal;
    dayP   += mealP;
    dayC   += mealC;
    dayF   += mealF;
  });

  day.dailyTotals = {
    calories: Math.round(dayCal),
    protein:  Math.round(dayP),
    carbs:    Math.round(dayC),
    fat:      Math.round(dayF),
  };
}

function calculateTargetCalories(clientData) {
  const weight = parseFloat(clientData.weight);
  const height = parseFloat(clientData.height);
  const age    = parseFloat(clientData.age);
  const gender = clientData.gender;
  const activityLevel = clientData.activityLevel;

  let bmr;
  if (gender === 'M') {
    bmr = 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age;
  } else {
    bmr = 447.593 + 9.247 * weight + 3.098 * height - 4.330 * age;
  }

  const activityMultipliers = {
    sedentary:   1.2,
    light:       1.375,
    moderate:    1.55,
    very_active: 1.725,
  };

  const tdee = bmr * (activityMultipliers[activityLevel] || 1.55);

  const goalAdjustments = {
    weight_loss:   0.85,
    muscle_gain:   1.1,
    maintenance:   1.0,
    recomposition: 0.95,
  };

  return Math.round(tdee * (goalAdjustments[clientData.goal] || 1.0));
}

function getMacroSplit(goal) {
  // Proteine și grăsimi per kg corp
  // Grăsimi: 1g/kg corp pentru toate obiectivele
  const splits = {
    weight_loss:   { proteinPerKg: 2.25, fatPerKg: 1.0 },
    muscle_gain:   { proteinPerKg: 1.9,  fatPerKg: 1.0 },
    maintenance:   { proteinPerKg: 1.9,  fatPerKg: 1.0 },
    recomposition: { proteinPerKg: 2.25, fatPerKg: 1.0 },
  };
  return splits[goal] || splits.maintenance;
}

function calculateMacros(goal, weightKg, targetCalories) {
  const split = getMacroSplit(goal);

  const proteinGrams = Math.round(split.proteinPerKg * weightKg);
  const fatGrams     = Math.round(split.fatPerKg * weightKg);

  const proteinCalories   = proteinGrams * 4;
  const fatCalories       = fatGrams * 9;
  const remainingCalories = targetCalories - proteinCalories - fatCalories;
  const carbsGrams        = Math.round(Math.max(remainingCalories, 0) / 4);

  return { protein: proteinGrams, carbs: carbsGrams, fat: fatGrams };
}

function getGoalLabel(goal) {
  const labels = {
    weight_loss:   'Slăbit',
    muscle_gain:   'Creștere masă musculară',
    maintenance:   'Menținere',
    recomposition: 'Recompoziție corporală',
  };
  return labels[goal] || 'Menținere';
}

function getDietLabel(diet) {
  const labels = {
    omnivore:   'Omnivor',
    vegetarian: 'Vegetarian',
    vegan:      'Vegan',
  };
  return labels[diet] || 'Omnivor';
}

function getMealDistribution(mealsPerDay) {
  const distributions = {
    3: { 'Mic Dejun': 0.30, 'Prânz': 0.40, 'Cină': 0.30 },
    4: { 'Mic Dejun': 0.25, 'Prânz': 0.35, 'Cină': 0.30, 'Gustare': 0.10 },
    5: { 'Mic Dejun': 0.20, 'Prânz': 0.30, 'Gustare 1': 0.10, 'Cină': 0.30, 'Gustare 2': 0.10 },
  };
  return distributions[mealsPerDay] || distributions[3];
}