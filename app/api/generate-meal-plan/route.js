import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import jwt from 'jsonwebtoken';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export async function POST(request) {
  try {
    // Verify JWT token
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('Missing auth header or Bearer prefix');
      return NextResponse.json(
        { error: 'Token JWT lipsă. Autentificare necesară.' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
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

    // Validate required fields
    if (!clientData.name || !clientData.age || !clientData.weight || !clientData.height) {
      return NextResponse.json(
        { error: 'Date lipsă: nume, vârstă, greutate și înălțime sunt obligatorii' },
        { status: 400 }
      );
    }

    // Build the prompt
    const prompt = buildPrompt(clientData);

    // Call OpenAI API
    const message = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `Ești un nutriționist expert care creează planuri alimentare personalizate.
          Creează planuri echilibrate nutrițional, ținând cont de preferințele și restricțiile clientului.
          Răspunde NUMAI în limba română și structurează răspunsul în secțiuni clare: Mic Dejun, Prânz, Cină și Gustări.
          Pentru fiecare secțiune, listează alimentele și o scurtă descriere (ex: calorii, nutrienți cheie).`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const plan = message.choices[0].message.content;

    return NextResponse.json({
      success: true,
      plan,
      clientData,
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

function buildPrompt(clientData) {
  const calorieEstimate = estimateCalories(
    clientData.weight,
    clientData.height,
    clientData.age,
    clientData.gender,
    clientData.activityLevel
  );

  const goalAdjustment = getCalorieAdjustment(clientData.goal);
  const adjustedCalories = Math.round(calorieEstimate * goalAdjustment);

  const mealsPerDayNum = parseInt(clientData.mealsPerDay);
  const mealDistribution = getMealDistribution(mealsPerDayNum);

  let prompt = `Generează un plan alimentar pentru O ZI pentru:

**CLIENT:**
- Nume: ${clientData.name}
- Vârstă: ${clientData.age} ani
- Sex: ${clientData.gender === 'M' ? 'Masculin' : 'Feminin'}
- Greutate: ${clientData.weight} kg
- Înălțime: ${clientData.height} cm

**ACTIVITATE ȘI OBIECTIV:**
- Nivel activitate: ${getActivityLevelLabel(clientData.activityLevel)}
- Obiectiv: ${getGoalLabel(clientData.goal)}
- Calorii estimate zilnic: ~${adjustedCalories} kcal
- Număr mese: ${mealsPerDayNum}

**PREFERINȚE ALIMENTARE:**
- Tip dietă: ${getDietLabel(clientData.dietType)}`;

  if (clientData.allergies && clientData.allergies.trim()) {
    prompt += `\n- Alergii/Excluderi: ${clientData.allergies}`;
  }

  prompt += `\n\n**DISTRIBUȚIE CALORII PENTRU ${mealsPerDayNum} MESE:**\n`;
  Object.entries(mealDistribution).forEach(([meal, percent]) => {
    const calories = Math.round(adjustedCalories * percent);
    prompt += `- ${meal}: ~${calories} kcal\n`;
  });

  prompt += `\n**INSTRUCȚIUNI IMPORTANTE:**
1. Creează un plan pentru o singură zi
2. Distribuie calorii conform distribuției de mai sus
3. Respectă restricțiile alimentare și alergiile menționate
4. Asigură nutriția echilibrată (proteine, grăsimi, carbohidrați)
5. Include alimente ușor de găsit și pregătit
6. Pentru fiecare masă, listează alimentele specifice pe rânduri separate
7. Răspunde NUMAI în limba română
8. **FĂRĂ alte mese decât cele specificate mai jos**

**FORMAT RĂSPUNS - EXACT ${mealsPerDayNum} MESE:**\n`;

  if (mealsPerDayNum === 3) {
    prompt += `Masa 1
- aliment 1
- aliment 2
etc.

Masa 2
- aliment 1
- aliment 2
etc.

Masa 3
- aliment 1
- aliment 2
etc.`;
  } else if (mealsPerDayNum === 4) {
    prompt += `Masa 1
- aliment 1
- aliment 2
etc.

Masa 2
- aliment 1
- aliment 2
etc.

Masa 3
- aliment 1
- aliment 2
etc.

Masa 4
- aliment 1
- aliment 2
etc.`;
  } else if (mealsPerDayNum === 5) {
    prompt += `Masa 1
- aliment 1
- aliment 2
etc.

Masa 2
- aliment 1
- aliment 2
etc.

Masa 3
- aliment 1
- aliment 2
etc.

Masa 4
- aliment 1
- aliment 2
etc.

Masa 5
- aliment 1
- aliment 2
etc.`;
  }

  return prompt;
}

function estimateCalories(weight, height, age, gender, activityLevel) {
  weight = parseFloat(weight);
  height = parseFloat(height);
  age = parseFloat(age);

  // Harris-Benedict formula pentru BMR
  let bmr;
  if (gender === 'M') {
    bmr = 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age;
  } else {
    bmr = 447.593 + 9.247 * weight + 3.098 * height - 4.330 * age;
  }

  const activityMultipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    very_active: 1.725,
  };

  const tdee = bmr * (activityMultipliers[activityLevel] || 1.55);
  return Math.round(tdee);
}

function getCalorieAdjustment(goal) {
  const adjustments = {
    weight_loss: 0.85,      // -15%
    muscle_gain: 1.1,       // +10%
    maintenance: 1.0,       // same
    recomposition: 0.95,    // -5%
  };
  return adjustments[goal] || 1.0;
}

function getMealDistribution(mealsPerDay) {
  const distributions = {
    3: {
      'Mic Dejun': 0.25,
      'Prânz': 0.45,
      'Cină': 0.30,
    },
    4: {
      'Mic Dejun': 0.25,
      'Prânz': 0.35,
      'Cină': 0.30,
      'Gustări': 0.10,
    },
    5: {
      'Mic Dejun': 0.20,
      'Prânz': 0.35,
      'Gustări 1': 0.10,
      'Cină': 0.30,
      'Gustări 2': 0.05,
    },
  };
  return distributions[mealsPerDay] || distributions[3];
}

function getActivityLevelLabel(level) {
  const labels = {
    sedentary: 'Sedentar (birou, fără sport)',
    light: 'Ușor activ (1-3 zile/săptămână)',
    moderate: 'Moderat activ (3-5 zile/săptămână)',
    very_active: 'Foarte activ (6-7 zile/săptămână)',
  };
  return labels[level] || 'Moderat activ';
}

function getGoalLabel(goal) {
  const labels = {
    weight_loss: 'Slăbit',
    muscle_gain: 'Creștere masă musculară',
    maintenance: 'Menținere',
    recomposition: 'Recompoziție corporală',
  };
  return labels[goal] || 'Menținere';
}

function getDietLabel(diet) {
  const labels = {
    omnivore: 'Omnivor',
    vegetarian: 'Vegetarian',
    vegan: 'Vegan',
  };
  return labels[diet] || 'Omnivor';
}
