import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { checkRateLimit, requestQueue, generateRequestId } from '@/app/lib/rateLimiter';
import { cachedCalculateCalories, cachedCalculateMacros, getCachedMealDistribution } from '@/app/lib/nutritionCache';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Cache pentru alimentele din baza de date (se reîmprospătează la fiecare 5 minute)
let foodsCache = null;
let foodsCacheTimestamp = 0;
const FOODS_CACHE_TTL = 5 * 60 * 1000; // 5 minute

/**
 * Încarcă alimentele din Supabase, filtrate după tipul de dietă și alergii
 * @param {string} dietType - 'omnivore', 'vegetarian', 'vegan'
 * @param {string} allergiesText - text cu alergii separate prin virgulă
 * @returns {Promise<Array>} - lista de alimente filtrate
 */
async function loadFoodsFromSupabase(dietType = 'omnivore', allergiesText = '') {
  const now = Date.now();
  
  // Verifică dacă cache-ul e valid
  if (foodsCache && (now - foodsCacheTimestamp) < FOODS_CACHE_TTL) {
    console.log('Folosesc alimentele din cache');
    return filterFoods(foodsCache, dietType, allergiesText);
  }
  
  console.log('Încarc alimentele din Supabase...');
  const { data: foods, error } = await supabase
    .from('foods')
    .select('name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal')
    .eq('is_active', true)
    .order('category')
    .order('name');
  
  if (error) {
    console.error('Eroare la încărcarea alimentelor din Supabase:', error.message);
    return [];
  }
  
  // Actualizează cache-ul
  foodsCache = foods;
  foodsCacheTimestamp = now;
  console.log(`Încărcate ${foods.length} alimente din Supabase`);
  
  return filterFoods(foods, dietType, allergiesText);
}

/**
 * Filtrează alimentele după tipul de dietă și alergii
 */
function filterFoods(foods, dietType, allergiesText) {
  // Parsează alergiile din text
  const allergyKeywords = allergiesText
    ? allergiesText.toLowerCase().split(/[,;\s]+/).filter(a => a.trim())
    : [];
  
  return foods.filter(food => {
    // Verifică dacă alimentul e compatibil cu dieta
    if (!food.diet_types.includes(dietType)) {
      return false;
    }
    
    // Verifică dacă alimentul conține alergeni
    if (allergyKeywords.length > 0 && food.allergens && food.allergens.length > 0) {
      const hasAllergen = food.allergens.some(allergen => 
        allergyKeywords.some(keyword => 
          allergen.toLowerCase().includes(keyword) || keyword.includes(allergen.toLowerCase())
        )
      );
      if (hasAllergen) return false;
    }
    
    return true;
  });
}

/**
 * Generează contextul cu alimentele pentru prompt
 */
function generateFoodsContext(foods) {
  if (!foods || foods.length === 0) {
    return 'Nu există alimente disponibile în baza de date.';
  }
  
  // Grupează alimentele pe categorii
  const categories = {
    meat: 'CARNE',
    fish: 'PEȘTE ȘI FRUCTE DE MARE',
    eggs: 'OUĂ',
    dairy: 'LACTATE',
    grains: 'CEREALE',
    starch: 'AMIDON (CARTOFI)',
    legumes: 'LEGUMINOASE',
    vegetables: 'LEGUME',
    fruits: 'FRUCTE',
    nuts: 'NUCI ȘI SEMINȚE',
    fats: 'ULEIURI ȘI GRĂSIMI',
    other: 'ALTELE'
  };
  
  const grouped = {};
  foods.forEach(food => {
    const cat = food.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(food);
  });
  
  let context = '';
  for (const [catKey, catName] of Object.entries(categories)) {
    if (grouped[catKey] && grouped[catKey].length > 0) {
      context += `\n── ${catName} ──\n`;
      grouped[catKey].forEach(food => {
        context += `- ${food.name}: ${food.calories_per_100g} kcal, ${food.protein_per_100g}g P, ${food.carbs_per_100g}g C, ${food.fat_per_100g}g G per 100g\n`;
      });
    }
  }
  
  return context;
}

// Funcție pentru sanitizarea textului înainte de trimitere la OpenAI
function sanitizeForPrompt(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/"/g, '\\"')    // Escape double quotes
    .trim();
}

// Configurare pentru generare paralelă
const PARALLEL_CONFIG = {
  // Numărul de zile generate în paralel (2-3 e optim pentru OpenAI rate limits)
  PARALLEL_DAYS: 2,
  // Timeout per zi (ms)
  DAY_TIMEOUT_MS: 30000,
  // Retry attempts per zi
  MAX_RETRIES: 2,
};

export async function POST(request) {
  const requestId = generateRequestId();
  
  try {
    const auth = verifyToken(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // ─── Rate Limiting ───────────────────────────────────────────
    const rateCheck = checkRateLimit(auth.userId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.reason },
        { 
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfter) }
        }
      );
    }

    // ─── Request Queue (concurrency control) ─────────────────────
    try {
      await requestQueue.waitForSlot(requestId);
    } catch (queueError) {
      return NextResponse.json(
        { error: queueError.message },
        { status: 503 }
      );
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

    // Progresul clientului (dacă e regenerare pe baza progresului)
    const progress = clientData.progress || null;
    const { name, age, weight, height, goal, activityLevel, allergies, mealsPerDay, dietType, foodPreferences } = clientData;

    // Verifică dacă progresul e în intervalul optim pentru obiectiv (nu necesită regenerare)
    if (progress?.currentWeight && clientData.clientId) {
      const oldWeight = parseFloat(weight);
      const newWeight = parseFloat(progress.currentWeight);
      const weightChangePercent = ((newWeight - oldWeight) / oldWeight) * 100;
      
      // Log: începe evaluarea progresului
      logActivity({
        action: 'progress.evaluation_start',
        status: 'success',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: { 
          clientId: clientData.clientId, 
          clientName: name,
          oldWeight,
          newWeight,
          weightChangePercent: weightChangePercent.toFixed(2),
          goal,
          hungerLevel: progress.hungerLevel || 'normal',
          energyLevel: progress.energyLevel || 'normal',
          weeksNoChange: progress.weeksNoChange || '0'
        },
      });

      // Extrage datele de foame și stagnare
      const hungerLevel = progress.hungerLevel || 'normal';
      const energyLevel = progress.energyLevel || 'normal';
      const weeksNoChange = parseInt(progress.weeksNoChange) || 0;
      const adherence = progress.adherence || 'complet'; // 'complet', 'partial', 'deloc'
      
      // ─── Cazuri speciale de foame și energie ───────────────────
      let hungerAdjustment = 0;
      let needsCarbRedistribution = false;
      let hungerMessage = '';

      // Foame extremă + energie scăzută → +100 kcal SAU redistribuție carbo
      if (hungerLevel === 'extrem' && energyLevel === 'scazut') {
        hungerAdjustment = 100;
        needsCarbRedistribution = true;
        hungerMessage = 'Foame extremă cu energie scăzută detectată - se adaugă +100 kcal și se redistribuie carbohidrații.';
        console.log(hungerMessage);
      }
      // Foame constantă → +100 kcal
      else if (hungerLevel === 'crescut' || hungerLevel === 'extrem') {
        hungerAdjustment = 100;
        hungerMessage = 'Foame crescută detectată - se adaugă +100 kcal.';
        console.log(hungerMessage);
      }

      // ─── Stagnare 2+ săptămâni cu greutate stabilă → ±150-200 kcal ───
      let stagnationAdjustment = 0;
      let stagnationMessage = '';
      const isWeightStable = Math.abs(weightChangePercent) < 0.3;
      
      if (weeksNoChange >= 2 && isWeightStable) {
        // La stagnare, ajustăm în funcție de obiectiv
        if (goal === 'weight_loss') {
          stagnationAdjustment = -175; // scade 150-200 kcal
          stagnationMessage = 'Stagnare 2+ săptămâni pe cut - se scad 175 kcal pentru a relansa progresul.';
          console.log(stagnationMessage);
        } else if (goal === 'muscle_gain') {
          stagnationAdjustment = 175; // adaugă 150-200 kcal
          stagnationMessage = 'Stagnare 2+ săptămâni pe masă - se adaugă 175 kcal pentru a relansa creșterea.';
          console.log(stagnationMessage);
        } else if (goal === 'maintenance') {
          // Menținere: stagnarea e de fapt SUCCESUL — greutatea e stabilă, exact cum trebuie
          // Nu facem nicio ajustare — planul funcționează perfect
          console.log('Menținere cu greutate stabilă — planul funcționează, nu se regenerează.');
        }
      }

      let isOptimalProgress = false;
      let progressMessage = '';

      // Verifică intervalele optime DOAR dacă nu avem cazuri speciale de foame/stagnare
      const hasSpecialCase = hungerAdjustment !== 0 || stagnationAdjustment !== 0;

      // ─── CAZ SPECIAL: Adherență DELOC - nu se regenerează planul dacă obiectivul nu e îndeplinit ───
      if (adherence === 'deloc') {
        // Dacă clientul nu a respectat planul deloc, problema nu e planul, ci respectarea lui
        // Actualizăm doar greutatea și returnăm mesaj că trebuie să respecte planul
        const { error: updateError } = await supabase
          .from('clients')
          .update({ weight: newWeight })
          .eq('id', clientData.clientId);

        if (updateError) {
          console.error('Eroare la actualizarea greutății clientului:', updateError.message);
        }

        logActivity({
          action: 'client.weight_update',
          status: 'success',
          userId: auth.userId,
          email: auth.email,
          ipAddress: ip,
          userAgent,
          details: { 
            clientId: clientData.clientId, 
            clientName: name,
            oldWeight,
            newWeight,
            changePercent: weightChangePercent.toFixed(2),
            goal,
            adherence: 'deloc',
            noRegeneration: true
          },
        });

        return NextResponse.json({
          type: 'optimal_progress',
          message: 'Planul nu a fost respectat. Pentru rezultate, te rog respectă planul alimentar actual înainte de a genera unul nou.',
          weightUpdated: true,
          oldWeight,
          newWeight,
          changePercent: weightChangePercent.toFixed(2)
        });
      }

      // ─── CAZ SPECIAL: Adherență PARȚIALĂ - marja mai permisivă ───
      let weightToleranceMultiplier = 1.0; // Factor de multiplicare pentru toleranță
      if (adherence === 'partial') {
        weightToleranceMultiplier = 1.5; // Marja cu 50% mai permisivă
        console.log('Adherență parțială detectată - se folosește marja de variație mai permisivă (×1.5)');
      }

      // Menținere cu greutate stabilă = succes mereu, indiferent de stagnare
      if (goal === 'maintenance' && isWeightStable) {
        isOptimalProgress = true;
        progressMessage = `Greutate stabilă! Variație de doar ${weightChangePercent >= 0 ? '+' : ''}${weightChangePercent.toFixed(2)}% — perfect pentru menținere${weeksNoChange >= 2 ? ' (greutate menținută constant, planul funcționează excelent)' : ''}.`;
      }

      if (!isOptimalProgress && !hasSpecialCase) {
        if (goal === 'weight_loss') {
          // Cut: -0.2% până la -1.0% pe săptămână e progres bun (cu ajustare pentru adherență)
          const minLoss = -1.0 * weightToleranceMultiplier; // poate fi -1.5% dacă adherență parțială
          const maxLoss = -0.2 / weightToleranceMultiplier; // poate fi -0.13% dacă adherență parțială
          if (weightChangePercent >= minLoss && weightChangePercent <= maxLoss) {
            isOptimalProgress = true;
            progressMessage = `Progres excelent! Ai slăbit ${Math.abs(weightChangePercent).toFixed(2)}% (${(newWeight - oldWeight).toFixed(1)} kg) - planul funcționează, continuă!${adherence === 'partial' ? ' Încearcă să respecți mai bine planul pentru rezultate mai constante.' : ''}`;
          }
        } else if (goal === 'maintenance') {
          // Menținere: ±0.3% e stabil (cu ajustare pentru adherență)
          const tolerance = 0.3 * weightToleranceMultiplier; // poate fi ±0.45% dacă adherență parțială
          if (weightChangePercent >= -tolerance && weightChangePercent <= tolerance) {
            isOptimalProgress = true;
            progressMessage = `Greutate stabilă! Variație de doar ${weightChangePercent >= 0 ? '+' : ''}${weightChangePercent.toFixed(2)}% - perfect pentru menținere.${adherence === 'partial' ? ' Încearcă să respecți mai bine planul pentru menținere mai ușoară.' : ''}`;
          }
        } else if (goal === 'muscle_gain') {
          // Masă musculară: +0.25% până la +0.50% pe săptămână e optim (cu ajustare pentru adherență)
          const minGain = 0.25 / weightToleranceMultiplier; // poate fi +0.17% dacă adherență parțială
          const maxGain = 0.50 * weightToleranceMultiplier; // poate fi +0.75% dacă adherență parțială
          if (weightChangePercent >= minGain && weightChangePercent <= maxGain) {
            isOptimalProgress = true;
            progressMessage = `Progres excelent! Ai luat ${weightChangePercent.toFixed(2)}% (${(newWeight - oldWeight).toFixed(1)} kg) - în intervalul optim pentru creștere musculară.${adherence === 'partial' ? ' Încearcă să respecți mai bine planul pentru creștere mai controlată.' : ''}`;
          }
        }
      }

      if (isOptimalProgress) {
        // Actualizează doar greutatea clientului în baza de date
        const { error: updateError } = await supabase
          .from('clients')
          .update({ weight: newWeight })
          .eq('id', clientData.clientId);

        if (updateError) {
          console.error('Eroare la actualizarea greutății clientului:', updateError.message);
        } else {
          console.log('Greutate actualizată pentru client:', clientData.clientId, '→', newWeight, 'kg');
        }

        logActivity({
          action: 'client.weight_update',
          status: 'success',
          userId: auth.userId,
          email: auth.email,
          ipAddress: ip,
          userAgent,
          details: { 
            clientId: clientData.clientId, 
            clientName: name,
            oldWeight,
            newWeight,
            changePercent: weightChangePercent.toFixed(2),
            goal,
            optimalProgress: true
          },
        });

        // Returnează răspuns special - nu regenera planul
        return NextResponse.json({
          type: 'optimal_progress',
          message: progressMessage,
          weightUpdated: true,
          oldWeight,
          newWeight,
          changePercent: weightChangePercent.toFixed(2)
        });
      }

      // Progresul NU e în intervalul optim - calculează ajustarea de calorii
      // Log: se decide regenerarea planului
      logActivity({
        action: 'progress.regeneration_needed',
        status: 'success',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: { 
          clientId: clientData.clientId, 
          clientName: name,
          oldWeight,
          newWeight,
          weightChangePercent: weightChangePercent.toFixed(2),
          goal,
          reason: hasSpecialCase ? 'special_case' : 'suboptimal_progress',
          hungerAdjustment,
          stagnationAdjustment,
          hungerMessage: hungerMessage || null,
          stagnationMessage: stagnationMessage || null
        },
      });

      let calorieAdjustment = 0;
      
      // Ajustări bazate pe schimbarea greutății
      if (goal === 'weight_loss') {
        if (weightChangePercent > -0.4) {
          // Nu a slăbit destul - scade calorii
          calorieAdjustment = -125; // -100 până la -150
        } else if (weightChangePercent < -0.8) {
          // A slăbit prea mult - crește calorii
          calorieAdjustment = 125;
        }
      } else if (goal === 'maintenance') {
        if (weightChangePercent > 0.3) {
          // A luat în greutate - scade calorii
          calorieAdjustment = -100;
        } else if (weightChangePercent < -0.3) {
          // A slăbit - crește calorii
          calorieAdjustment = 100;
        }
      } else if (goal === 'muscle_gain') {
        if (weightChangePercent < 0.25) {
          // Nu a luat destul - crește calorii
          calorieAdjustment = 125;
        } else if (weightChangePercent > 0.50) {
          // A luat prea mult (risc de grăsime) - scade calorii
          calorieAdjustment = -100;
        }
      }

      // ─── Adaugă ajustările speciale de foame și stagnare ───
      // Foamea are prioritate - adăugăm caloriile pentru foame
      if (hungerAdjustment > 0) {
        calorieAdjustment += hungerAdjustment;
        console.log(`Ajustare foame aplicată: +${hungerAdjustment} kcal`);
      }
      
      // Stagnarea se aplică doar dacă nu avem deja o ajustare mare
      if (stagnationAdjustment !== 0 && Math.abs(calorieAdjustment) < 150) {
        calorieAdjustment = stagnationAdjustment; // înlocuiește cu ajustarea de stagnare
        console.log(`Ajustare stagnare aplicată: ${stagnationAdjustment} kcal`);
      }

      // Stochează flag-ul pentru redistribuție carbo (foame extremă + energie scăzută)
      if (needsCarbRedistribution) {
        clientData._needsCarbRedistribution = true;
      }

      // Stochează ajustarea pentru a o folosi în calculul caloriilor
      clientData._calorieAdjustment = calorieAdjustment;
      console.log(`Ajustare calorii pentru ${goal}: ${calorieAdjustment} kcal (schimbare greutate: ${weightChangePercent.toFixed(2)}%)`);
    }

    // Dacă avem greutate nouă din progres, recalculăm caloriile
    let targetCalories, proteinGrams, carbsGrams, fatGrams;
    const effectiveWeight = progress?.currentWeight ? parseFloat(progress.currentWeight) : parseFloat(clientData.weight);
    const effectiveClientData = progress?.currentWeight ? { ...clientData, weight: String(effectiveWeight) } : clientData;
    
    // Dacă avem o ajustare de calorii și știm caloriile planului curent,
    // aplicăm ajustarea față de planul curent (nu față de recalculul pentru greutatea nouă)
    if (clientData._calorieAdjustment && clientData.currentPlanCalories) {
      targetCalories = clientData.currentPlanCalories + clientData._calorieAdjustment;
      console.log(`Calorii ajustate față de planul curent: ${clientData.currentPlanCalories} + (${clientData._calorieAdjustment}) = ${targetCalories} kcal`);
    } else {
      // Fără ajustare sau fără plan curent — calculează normal
      targetCalories = cachedCalculateCalories(effectiveClientData, calculateTargetCalories);
      if (clientData._calorieAdjustment) {
        targetCalories += clientData._calorieAdjustment;
        console.log(`Calorii ajustate față de TDEE recalculat: ${targetCalories} kcal`);
      }
    }
    
    // Folosește cache pentru macros
    const macros = cachedCalculateMacros(clientData.goal, effectiveWeight, targetCalories, calculateMacros);
    proteinGrams = macros.protein;
    carbsGrams = macros.carbs;
    fatGrams = macros.fat;

    const sex = clientData.gender === 'M' ? 'Masculin' : 'Feminin';
    const mealsNum = parseInt(mealsPerDay) || 3;

    // Folosește cache pentru distribuția meselor
    const mealDistribution = getCachedMealDistribution(mealsNum);
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

    // Încarcă alimentele din Supabase, filtrate după dietă și alergii
    const availableFoods = await loadFoodsFromSupabase(dietType || 'omnivore', allergies || '');
    const foodsContext = generateFoodsContext(availableFoods);
    console.log(`Alimente disponibile pentru plan: ${availableFoods.length}`);

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
        let streamClosed = false;
        const closeStream = () => {
          if (!streamClosed) { streamClosed = true; controller.close(); }
        };
        let loggedCancelled = false;
        const logCancelled = (details) => {
          if (loggedCancelled) return;
          loggedCancelled = true;
          logActivity({
            action: 'meal_plan.generate',
            status: 'cancelled',
            userId: auth.userId,
            email: auth.email,
            ipAddress: ip,
            userAgent,
            details,
          });
        };
        try {
    const days = [];
    // Stochează mesele anterioare ca combinații complete pentru anti-repetiție
    const previousMeals = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      if (request.signal.aborted) {
        console.log(`Generare întreruptă de client după ziua ${dayIndex}.`);
        logCancelled({ clientId: clientData.clientId || null, clientName: clientData.name, daysCompleted: dayIndex, reason: 'user_aborted' });
        closeStream();
        return;
      }
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
REGULA #3: FOLOSEȘTE DOAR alimentele din LISTA DE ALIMENTE DISPONIBILE de mai jos.
Valorile nutriționale sunt per 100g și TREBUIE respectate exact cum sunt în listă.
NU inventa alimente sau valori nutriționale - folosește DOAR ce e în lista de mai jos.

═══ LISTA DE ALIMENTE DISPONIBILE (folosește DOAR aceste alimente cu valorile exacte) ═══
${foodsContext}
═══ SFÂRȘIT LISTĂ ALIMENTE ═══

REGULA #4: Fiecare masă trebuie să fie o REȚETĂ reală, nu o simplă combinație de ingrediente.
  - Masa principală: omletă cu spanac și roșii, ovăz cu iaurt și fructe de pădure, toast integral cu avocado și ou, orez cu pui și legume la tigaie, salată cu pui, avocado și dressing de iaurt, paste integrale cu sos de roșii și busuioc, cartofi dulci la cuptor cu pui și salată, quinoa cu legume și pui, somon la cuptor cu broccoli și morcovi, pui la cuptor cu cartofi dulci și salată, omletă cu legume și brânză slabă, supă cremă de legume cu semințe, etc.
  - Gustare: iaurt grecesc cu fructe și semințe, măr cu unt de arahide, shake proteic cu banană, hummus cu morcovi și castraveți, nuci și migdale crude, brânză cottage cu fructe, batoane de ovăz făcute acasă, smoothie cu banană și unt de arahide, budincă de chia cu lapte și fructe, etc.
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
} | Atentie CRITICA LA ALERGII: ${sanitizeForPrompt(allergies) || 'Niciuna'}${foodPreferences ? `

═══ PREFERINȚE ALIMENTARE ALE CLIENTULUI (FOARTE IMPORTANT) ═══
Clinetul a specificat următoarele preferințe: ${sanitizeForPrompt(foodPreferences)}
- Dă PRIORITATE alimentelor pe care clientul le preferă
- EVITĂ alimentele pe care clientul a menționat că nu îi plac
- Folosește alimentele preferate cât mai des posibil în planul alimentar
═══ SFÂRȘIT PREFERINȚE ═══` : ''}
${progress ? `
CONTEXT IMPORTANT — REGENERARE PE BAZA PROGRESULUI CLIENTULUI:
- Obiectiv client: ${goal === 'weight_loss' ? 'Slăbit' : goal === 'muscle_gain' ? 'Creștere masă musculară' : goal === 'maintenance' ? 'Menținere' : goal === 'recomposition' ? 'Recompoziție corporală' : goal}
- Greutate curentă: ${progress.currentWeight || weight}kg${progress.currentWeight && weight ? ` (anterior: ${weight}kg, diferență: ${(parseFloat(progress.currentWeight) - parseFloat(weight)).toFixed(1)}kg)` : ''}
- Respectare plan anterior: ${progress.adherence === 'complet' ? 'Complet' : progress.adherence === 'partial' ? 'Parțial' : progress.adherence === 'deloc' ? 'Deloc' : progress.adherence || 'N/A'}
- Nivel energie: ${progress.energyLevel === 'scazut' ? 'Scăzut' : progress.energyLevel === 'normal' ? 'Normal' : progress.energyLevel === 'ridicat' ? 'Ridicat' : progress.energyLevel || 'N/A'}
- Nivel foame: ${progress.hungerLevel === 'normal' ? 'Normal' : progress.hungerLevel === 'crescut' ? 'Crescut (foame constantă)' : progress.hungerLevel === 'extrem' ? 'Extrem (foame + oboseală)' : progress.hungerLevel || 'N/A'}
- Săptămâni fără schimbare: ${progress.weeksNoChange === '0' ? 'Prima săptămână' : progress.weeksNoChange === '1' ? '1 săptămână' : progress.weeksNoChange === '2' ? '2+ săptămâni' : progress.weeksNoChange || 'N/A'}
- Observații antrenor: ${sanitizeForPrompt(progress.notes) || 'Fără observații'}
ADAPTEAZĂ planul alimentar ținând cont de acest progres și OBIECTIVUL clientului:
${parseFloat(progress.currentWeight) < parseFloat(weight) ? '- Clientul a slăbit → menține direcția sau ajustează ușor în sus dacă pierderea e prea rapidă' : ''}
${parseFloat(progress.currentWeight) > parseFloat(weight) ? '- Clientul a luat în greutate → ajustează planul pentru a fi mai restrictiv sau mai echilibrat' : ''}
${progress.adherence === 'deloc' ? '- NU a respectat planul → fă mesele FOARTE SIMPLE, cu ingrediente comune și ușor de găsit, porții clare' : ''}
${progress.adherence === 'partial' ? '- A respectat parțial → simplificare ușoară, rețete mai rapide de pregătit' : ''}
${progress.adherence === 'complet' ? '- A respectat complet → menține nivelul de complexitate, introduce varietate nouă' : ''}
${progress.energyLevel === 'scazut' ? '- Energie scăzută → adaugă mai mulți carbohidrați complecși și asigură-te că mesele sunt bine distribuite' : ''}
${progress.energyLevel === 'normal' ? '- Energie normală → planul actual e echilibrat, menține structura' : ''}
${progress.energyLevel === 'ridicat' ? '- Energie ridicată → planul funcționează bine, poți introduce variații mai interesante' : ''}
${progress.hungerLevel === 'crescut' || progress.hungerLevel === 'extrem' ? `
ATENȚIE FOAME ${progress.hungerLevel === 'extrem' ? 'EXTREMĂ' : 'CONSTANTĂ'}:
- Include mai multe legume cu volum mare (salate, supă, castraveți, roșii) pentru sațietate
- Proteine la FIECARE masă pentru saț prolongat
- Evită carbohidrații rafinați - folosește doar carbohidrați complecși cu fibre (ovăz, quinoa, legume)
- Include gustări sărace în calorii dar voluminoase între mese` : ''}
${progress.hungerLevel === 'extrem' && progress.energyLevel === 'scazut' ? `
REDISTRIBUȚIE CARBOHIDRAȚI OBLIGATORIE (foame extremă + energie scăzută):
- Concentrează 50-60% din carbohidrați la MICUL DEJUN și PRÂNZ
- Cină mai săracă în carbohidrați dar bogată în proteine și grăsimi sănătoase
- Include surse de energie cu eliberare lentă: ovăz, cartofi dulci, quinoa
- Adaugă grăsimi sănătoase pentru energie susținută: avocado, nuci, ulei de măsline` : ''}
${progress.weeksNoChange === '2' ? `
STAGNARE DETECTATĂ (2+ săptămâni fără schimbare):
- Variază tipurile de alimente pentru a "șoca" metabolismul
- Schimbă structura meselor (dacă înainte era 3 mese mari, fă 4-5 mese mai mici)
- Include alimente noi pe care clientul nu le-a consumat anterior` : ''}
IMPORTANT: Generează un plan COMPLET NOU și DIFERIT de planul anterior, adaptat la progresul clientului.
` : ''}${avoidMealsStr}

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
              content: `Ești un nutriționist și chef AI precis. ATENȚIE CRITICĂ: Clientul are alergii la: ${sanitizeForPrompt(allergies) || 'Niciuna'}. Niciun aliment din această categorie nu trebuie să apară în plan. Returnează DOAR JSON valid pentru o singură zi. Fără markdown, fără blocuri de cod. Ziua trebuie să totalizeze ~${targets.calories} kcal cu P:${targets.protein}g C:${targets.carbs}g G:${targets.fat}g. Folosește nume de alimente și rețete în limba română. Creează mese variate și apetisante, nu combinații banale.${progress ? ' IMPORTANT: Acest plan este o REGENERARE bazată pe progresul clientului. Adaptează alegerile alimentare la feedback-ul și progresul menționat.' : ''}`,
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
    console.log('Verificare salvare plan - clientId:', clientData.clientId);
    let savedPlanId = null;
    if (clientData.clientId) {
      const { data: savedPlan, error: saveError } = await supabase
        .from('meal_plans')
        .insert({
          client_id: clientData.clientId,
          trainer_id: auth.userId,
          plan_data: plan,
          daily_targets: targets,
        })
        .select()
        .single();
      if (saveError) {
        console.error('Eroare la salvarea planului în Supabase:', saveError.message);
      } else {
        savedPlanId = savedPlan?.id || null;
        console.log('Plan salvat cu succes în Supabase cu ID:', savedPlanId, 'pentru clientul', clientData.clientId);
      }

      // Actualizează greutatea clientului și salvează în weight_history dacă avem progres cu greutate nouă
      if (progress?.currentWeight) {
        const newWeight = parseFloat(progress.currentWeight);
        const { error: weightUpdateError } = await supabase
          .from('clients')
          .update({ weight: newWeight })
          .eq('id', clientData.clientId);
        if (weightUpdateError) {
          console.error('Eroare la actualizarea greutății clientului:', weightUpdateError.message);
        } else {
          console.log('Greutate actualizată pentru client:', clientData.clientId, '→', newWeight, 'kg');
        }

        // Salvează în weight_history DOAR după ce planul a fost generat și salvat cu succes
        const { error: whErr } = await supabase
          .from('weight_history')
          .insert({
            client_id: clientData.clientId,
            weight: newWeight,
            notes: 'Actualizare progres din planul alimentar',
          });
        if (whErr) {
          console.error('[weight_history] Eroare la inserare (progres plan):', whErr.message, whErr);
        } else {
          console.log('[weight_history] Greutate salvată după generare plan:', newWeight, 'kg');
        }
      }
    } else {
      console.log('clientId lipsă, planul NU va fi salvat în baza de date');
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
    sendEvent({ type: 'complete', plan, nutritionalNeeds: targets, planId: savedPlanId });
        } catch (err) {
          if (request.signal.aborted || err.name === 'AbortError') {
            console.log('Generare anulată de client.');
            logCancelled({ clientId: clientData.clientId || null, clientName: clientData.name, reason: 'user_aborted' });
            closeStream();
            return;
          }
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
          closeStream();
          // Eliberează slot-ul din queue pentru scalabilitate
          requestQueue.releaseSlot();
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Request-Id': requestId,
      },
    });
  } catch (error) {
    // Eliberează slot-ul în caz de eroare
    requestQueue.releaseSlot();
    
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
    3: { 'Masa 1': 0.40, 'Gustare': 0.15, 'Masa 2': 0.45 },
    4: { 'Masa 1': 0.30, 'Gustare 1': 0.10, 'Masa 2': 0.45, 'Gustare 2': 0.15 },
    5: { 'Masa 1': 0.25, 'Gustare 1': 0.10, 'Masa 2': 0.30, 'Gustare 2': 0.10, 'Masa 3': 0.25 },
  };
  return distributions[mealsPerDay] || distributions[3];
}