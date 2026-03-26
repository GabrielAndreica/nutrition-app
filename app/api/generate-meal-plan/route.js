import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request) {
  try {
    const auth = verifyToken(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { ip, userAgent } = getRequestMeta(request);

    let clientData;
    try {
      clientData = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Body-ul cererii este invalid sau lipsă. Trimiteți un JSON valid.' },
        { status: 400 }
      );
    }

    const missingFields = [];
    if (!clientData.name)           missingFields.push('nume');
    if (!clientData.age)            missingFields.push('vârstă');
    if (!clientData.weight)         missingFields.push('greutate');
    if (!clientData.height)         missingFields.push('înălțime');
    if (!clientData.goal)           missingFields.push('obiectiv');
    if (!clientData.gender)         missingFields.push('gen');
    if (!clientData.activityLevel)  missingFields.push('nivel activitate');

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Câmpuri obligatorii lipsă: ${missingFields.join(', ')}.` },
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

    // Surse de proteine rotative pe zile — forțează varietatea
    const proteinSources = [
      'DOAR pui sau curcan — nicio altă carne',
      'DOAR pește sau fructe de mare — fără carne de pui sau vită',
      'DOAR ouă și lactate — fără nicio carne sau pește',
      'DOAR carne roșie (vită sau porc slab) — fără pui sau pește',
      'DOAR leguminoase și tofu — fără nicio carne sau pește',
      'DOAR pește sau ton — fără pui sau carne roșie',
      'Mix liber — dar diferit față de toate zilele anterioare',
    ];

    const dietRestrictions = {
      vegetarian: `DIETĂ VEGETARIANĂ — INTERZIS: carne de pui, vită, porc, pește, fructe de mare, gelatină.
                  PERMIS: ouă, lactate, legume, fructe, cereale, leguminoase, tofu, tempeh.`,
      vegan: `DIETĂ VEGANĂ — INTERZIS: orice produs animal (carne, pește, ouă, lapte, brânză, iaurt, miere, unt).
              PERMIS DOAR: legume, fructe, cereale, leguminoase, tofu, tempeh, lapte vegetal, nuci, semințe.`,
      omnivore: '',
};

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        const sendEvent = (obj) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        try {
    const days = [];
    // Stochează mesele anterioare ca combinații complete pentru anti-repetiție
    const previousMeals = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const dayNumber = dayIndex + 1;
      const dayName = dayNames[dayIndex];
      console.log(`Generare ziua ${dayNumber}/7 (${dayName})...`);
      sendEvent({ type: 'progress', day: dayNumber, total: 7 });

      const avoidMealsStr = previousMeals.length > 0
        ? `\nMESE DEJA FOLOSITE ÎN ZILELE ANTERIOARE (nu repeta aceleași combinații):
${previousMeals.slice(-9).join('\n')}`
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
  - Năut fiert: 164 kcal, 9g P, 27g C, 2.6g G per 100g
  - Linte fiartă: 116 kcal, 9g P, 20g C, 0.4g G per 100g
  - Ton conservă (în apă): 116 kcal, 26g P, 0g C, 1g G per 100g
  - Carne vită slabă: 217 kcal, 26g P, 0g C, 12g G per 100g
  - Ovăz: 389 kcal, 17g P, 66g C, 7g G per 100g
  - Quinoa fiartă: 120 kcal, 4.4g P, 21g C, 1.9g G per 100g
  - Cartofi dulci copți: 90 kcal, 2g P, 21g C, 0.1g G per 100g
  - Avocado: 160 kcal, 2g P, 9g C, 15g G per 100g
  - Migdale crude: 579 kcal, 21g P, 22g C, 50g G per 100g
  - Nuci: 654 kcal, 15g P, 14g C, 65g G per 100g
  - Unt de arahide: 588 kcal, 25g P, 20g C, 50g G per 100g
  - Semințe de chia: 486 kcal, 17g P, 42g C, 31g G per 100g
  - Semințe de dovleac: 559 kcal, 30g P, 11g C, 49g G per 100g
  - Ulei de măsline: 884 kcal, 0g P, 0g C, 100g G per 100g
  - Broccoli: 34 kcal, 2.8g P, 7g C, 0.4g G per 100g
  - Spanac: 23 kcal, 2.9g P, 3.6g C, 0.4g G per 100g
  - Morcovi: 41 kcal, 0.9g P, 10g C, 0.2g G per 100g
  - Ardei gras: 31 kcal, 1g P, 6g C, 0.3g G per 100g
  - Roșii: 18 kcal, 0.9g P, 3.9g C, 0.2g G per 100g
  - Castraveți: 15 kcal, 0.7g P, 3.6g C, 0.1g G per 100g
  - Măr: 52 kcal, 0.3g P, 14g C, 0.2g G per 100g
  - Fructe de pădure: 57 kcal, 0.7g P, 14g C, 0.3g G per 100g
  - Portocală: 47 kcal, 0.9g P, 12g C, 0.1g G per 100g
  - Kiwi: 61 kcal, 1.1g P, 15g C, 0.5g G per 100g
  - Lapte (3.5%): 61 kcal, 3.2g P, 4.8g C, 3.3g G per 100ml
  - Chefir: 55 kcal, 3.5g P, 4g C, 2g G per 100ml
  - Brânză feta: 264 kcal, 14g P, 4g C, 21g G per 100g
  - Mozzarella: 280 kcal, 28g P, 3g C, 17g G per 100g
  - Curcan (piept): 135 kcal, 29g P, 0g C, 1g G per 100g
  - Ouă albuș: 52 kcal, 11g P, 0.7g C, 0.2g G per 100g

REGULA #4: Fiecare masă trebuie să fie o REȚETĂ reală, nu o simplă combinație de ingrediente.
  - Mic dejun: omletă cu spanac și roșii, ovăz cu iaurt și fructe de pădure, toast integral cu avocado și ou, smoothie cu banană și unt de arahide, iaurt grecesc cu nuci și miere, clătite din ovăz și ou cu fructe, budincă de chia cu lapte și fructe, etc.
  - Prânz: orez cu pui și legume la tigaie, salată cu pui, avocado și dressing de iaurt, paste integrale cu sos de roșii și busuioc, cartofi dulci la cuptor cu pui și salată, quinoa cu legume și pui, tocăniță de linte cu legume, wrap integral cu ton și legume, etc.
  - Cină: somon la cuptor cu broccoli și morcovi, pui la cuptor cu cartofi dulci și salată, omletă cu legume și brânză slabă, orez cu legume și ou, salată mare cu ou și avocado, supă cremă de legume cu semințe, dovlecei la tigaie cu pui, etc.
  - Gustare: iaurt grecesc cu fructe și semințe, măr cu unt de arahide, shake proteic cu banană, hummus cu morcovi și castraveți, nuci și migdale crude, brânză cottage cu fructe, batoane de ovăz făcute acasă, etc.
  - EVITĂ combinații banale gen "pui fiert + orez fiert + broccoli fiert"
  - Fiecare rețetă trebuie să aibă MINIM 3 ingrediente
  - Instrucțiunile de preparare trebuie să fie clare și detaliate (3-4 pași)

  REGULA #5: Fiecare aliment din lista "foods" trebuie să fie UN SINGUR ingredient simplu.
  - GREȘIT: {"name": "Creveți cu orez și legume", "amount": 305, ...}
  - CORECT: 
    {"name": "Creveți", "amount": 150, ...},
    {"name": "Orez fiert", "amount": 100, ...},
    {"name": "Broccoli", "amount": 55, ...}
  - NICIODATĂ nu combina mai multe ingrediente într-un singur obiect
  - Numele alimentului = ingredient simplu, nu denumirea rețetei
  - Denumirea rețetei merge în câmpul "mealType", nu în "foods"

SURSA DE PROTEINE PENTRU ZIUA ${dayNumber} — OBLIGATORIU: ${proteinSources[dayIndex]}
Nu folosi altă sursă de proteine principală în afara celei specificate.

CLIENT: ${name}, ${age} ani, ${sex}, ${weight}kg, ${height}cm
Ziua ${dayNumber} (${dayName}) | Dietă: ${getDietLabel(dietType)}${
  dietType === 'vegetarian' ? ' (ATENTIE CRITICA: FARA carne, fără pește)' :
  dietType === 'vegan'      ? ' (ATENTIE CRITICA: FARA carne, pește, ouă, lactate, miere)' : ''
} | Atentie CRITICA LA ALERGII: ${allergies || 'Niciuna'}
${avoidMealsStr}

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
      "mealType": "Terci de ovaz cu lapte si miere",
      "foods": [
        {"name":"Fulgi de ovăz","amount":100,"unit":"g","calories":390,"protein":15,"carbs":65,"fat":7},
        {"name":"Lapte 1.5%","amount":300,"unit":"ml","calories":140,"protein":10,"carbs":15,"fat":5}
      ],
      "preparation": "Fierbe fulgii în lapte 5 minute la foc mic. Adaugă miere și scorțișoară după gust. Servește cald cu fructe proaspete deasupra.",
      "mealTotals": {"calories":530,"protein":25,"carbs":80,"fat":12}
    }
  ],
  "dailyTotals": {"calories":${targets.calories},"protein":${targets.protein},"carbs":${targets.carbs},"fat":${targets.fat}}
}`;

      let rawContent;
      try {
        const message = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `Ești un nutriționist și chef AI precis. ATENȚIE CRITICĂ: Clientul are alergii la: ${allergies}. Niciun aliment din această categorie nu trebuie să apară în plan. Returnează DOAR JSON valid pentru o singură zi. Fără markdown, fără blocuri de cod. Ziua trebuie să totalizeze ~${targets.calories} kcal cu P:${targets.protein}g C:${targets.carbs}g G:${targets.fat}g. Folosește nume de alimente și rețete în limba română. Creează mese variate și apetisante, nu combinații banale.`,
            },
            {
              role: 'user',
              content: dayPrompt,
            },
          ],
          temperature: 0.7,
          max_tokens: 3000,
        });
        rawContent = message.choices[0].message.content;
      } catch (openaiErr) {
        const isNetwork = openaiErr.code === 'ECONNREFUSED' || openaiErr.code === 'ENOTFOUND' || openaiErr.type === 'request_error';
        const isRateLimit = openaiErr.status === 429;
        const isOverloaded = openaiErr.status === 503;
        const isTimeout = openaiErr.code === 'ETIMEDOUT' || openaiErr.message?.includes('timeout');

        let msg;
        if (isNetwork || isOverloaded)  msg = 'Serviciul OpenAI nu este disponibil momentan. Vă rog încercați din nou în câteva minute.';
        else if (isRateLimit)           msg = 'Limita de cereri OpenAI a fost atinsă. Vă rog așteptați câteva secunde și încercați din nou.';
        else if (isTimeout)             msg = `Timeout la generarea zilei ${dayNumber}. Conexiunea a durat prea mult. Reîncercați.`;
        else                            msg = `Eroare OpenAI la ziua ${dayNumber}: ${openaiErr.message || 'eroare necunoscută'}`;

        throw new Error(msg);
      }

      let content = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      // Strip any leading non-JSON text (e.g. explanatory sentences before {)
      const jsonStart = content.indexOf('{');
      if (jsonStart > 0) content = content.slice(jsonStart);
      const jsonEnd = content.lastIndexOf('}');
      if (jsonEnd !== -1 && jsonEnd < content.length - 1) content = content.slice(0, jsonEnd + 1);

      let dayPlan;
      try {
        dayPlan = JSON.parse(content);
      } catch (parseErr) {
        console.error(`Day ${dayNumber}: Invalid JSON from OpenAI:`, content.slice(0, 200));
        throw new Error(
          `Ziua ${dayNumber}: OpenAI a returnat un răspuns invalid (JSON corupt). Reîncercați — se întâmplă ocazional.`
        );
      }

      recalculateDayTotals(dayPlan);
      adjustDayToTargets(dayPlan, targets);

      console.log(`Day ${dayNumber}: Done ✓ (${dayPlan.dailyTotals.calories} kcal)`);

      // Stochează mesele ca combinații complete pentru anti-repetiție
      if (dayPlan.meals) {
        dayPlan.meals.forEach(meal => {
          const foodNames = meal.foods
            ? meal.foods.map(f => f.name).join(', ')
            : '';
          previousMeals.push(`${meal.mealType}: ${foodNames}`);
        });
      }

      days.push(dayPlan);
    }

    const plan = { clientName: name, dailyTargets: targets, days };

    // Salvează planul în Supabase dacă există clientId
    if (clientData.clientId) {
      const { error: saveError } = await supabase
        .from('meal_plans')
        .insert({
          client_id: clientData.clientId,
          trainer_id: auth.userId,
          plan_data: plan,
          daily_targets: targets,
        });
      if (saveError) {
        console.error('Eroare la salvarea planului în Supabase:', saveError.message);
      } else {
        console.log('Plan salvat cu succes în Supabase pentru clientul', clientData.clientId);
      }
    }

    logActivity({
      action: 'meal_plan.generate',
      status: 'success',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { clientId: clientData.clientId || null, clientName: clientData.name },
    });
    sendEvent({ type: 'complete', plan, nutritionalNeeds: targets });
        } catch (err) {
          logActivity({
            action: 'meal_plan.generate',
            status: 'failure',
            userId: auth.userId,
            email: auth.email,
            ipAddress: ip,
            userAgent,
            details: { clientId: clientData.clientId || null, clientName: clientData.name, error: err.message },
          });
          sendEvent({ type: 'error', message: err.message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Error generating meal plan:', error);
    const { ip: errIp, userAgent: errUA } = getRequestMeta(request);
    logActivity({
      action: 'meal_plan.generate',
      status: 'failure',
      userId: null,
      email: null,
      ipAddress: errIp,
      userAgent: errUA,
      details: { error: error.message },
    });
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