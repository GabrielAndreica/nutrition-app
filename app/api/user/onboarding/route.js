import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

// Allowed enum values
const ALLOWED_FITNESS_LEVELS = ['beginner', 'intermediate', 'advanced'];
const ALLOWED_TRAINING_LOCATIONS = ['gym', 'home_dumbbells', 'home'];
const ALLOWED_GOALS = ['muscle_gain', 'weight_loss', 'maintenance', 'endurance', 'flexibility'];
const ALLOWED_DIET_TYPES = ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'keto', 'paleo'];
const ALLOWED_GENDERS = ['M', 'F'];
const ALLOWED_WORKOUTS_PER_WEEK = [2, 3, 4, 5, 6];

export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== 'user') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  // Rate limit: max 10 onboarding submissions per user per hour
  const rl = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-onboarding',
    maxRequests: 10,
    windowMinutes: 60,
  });
  if (rl) return rl;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const {
    age, height, weight, gender,
    fitnessLevel, workoutsPerWeek, trainingLocation,
    goal, dietType,
  } = body;

  // Validare câmpuri obligatorii
  const missingFields = [];
  if (!age) missingFields.push('vârstă');
  if (!height) missingFields.push('înălțime');
  if (!weight) missingFields.push('greutate');
  if (!gender) missingFields.push('gen');
  if (!fitnessLevel) missingFields.push('nivel fitness');
  if (!workoutsPerWeek) missingFields.push('antrenamente/săptămână');
  if (!trainingLocation) missingFields.push('locație antrenament');
  if (!goal) missingFields.push('obiectiv');

  if (missingFields.length > 0) {
    return NextResponse.json(
      { error: `Câmpuri lipsă: ${missingFields.join(', ')}.` },
      { status: 400 }
    );
  }

  // Validare valori numerice (bounds)
  const ageNum = Number(age);
  const heightNum = Number(height);
  const weightNum = Number(weight);
  const workoutsNum = Number(workoutsPerWeek);

  if (!Number.isFinite(ageNum) || ageNum < 14 || ageNum > 100)
    return NextResponse.json({ error: 'Vârsta trebuie să fie între 14 și 100 de ani.', field: 'age' }, { status: 400 });
  if (!Number.isFinite(heightNum) || heightNum < 100 || heightNum > 250)
    return NextResponse.json({ error: 'Înălțimea trebuie să fie între 100 și 250 cm.', field: 'height' }, { status: 400 });
  if (!Number.isFinite(weightNum) || weightNum < 30 || weightNum > 300)
    return NextResponse.json({ error: 'Greutatea trebuie să fie între 30 și 300 kg.', field: 'weight' }, { status: 400 });
  if (!ALLOWED_WORKOUTS_PER_WEEK.includes(workoutsNum))
    return NextResponse.json({ error: 'Număr de antrenamente invalid (2–6).', field: 'workoutsPerWeek' }, { status: 400 });

  // Validare enum-uri (whitelist)
  const genderNorm = String(gender).toUpperCase();
  if (!ALLOWED_GENDERS.includes(genderNorm))
    return NextResponse.json({ error: 'Gen invalid.', field: 'gender' }, { status: 400 });
  if (!ALLOWED_FITNESS_LEVELS.includes(fitnessLevel))
    return NextResponse.json({ error: 'Nivel fitness invalid.', field: 'fitnessLevel' }, { status: 400 });
  if (!ALLOWED_TRAINING_LOCATIONS.includes(trainingLocation))
    return NextResponse.json({ error: 'Locație antrenament invalidă.', field: 'trainingLocation' }, { status: 400 });
  if (!ALLOWED_GOALS.includes(goal))
    return NextResponse.json({ error: 'Obiectiv invalid.', field: 'goal' }, { status: 400 });
  const dietTypeSafe = dietType && ALLOWED_DIET_TYPES.includes(dietType) ? dietType : 'omnivore';

  // Mapare locație antrenament → echipament disponibil
  const equipmentMap = {
    gym: 'full gym',
    home_dumbbells: 'dumbbells only',
    home: 'no equipment',
  };
  const availableEquipment = equipmentMap[trainingLocation] || 'full gym';

  // Mapare nivel fitness → training split recomandat
  const splitMap = {
    beginner: 'Full Body',
    intermediate: 'Push/Pull/Legs',
    advanced: 'Push/Pull/Legs',
  };
  const trainingSplit = splitMap[fitnessLevel] || 'Full Body';

  // Mapare antrenamente/săptămână → nivel activitate
  const activityMap = {
    2: 'light',
    3: 'moderate',
    4: 'moderate',
    5: 'very_active',
    6: 'very_active',
  };
  const activityLevel = activityMap[workoutsNum] || 'moderate';

  const supabase = getSupabase();

  // Obține numele utilizatorului din tabelul users
  const { data: userRow } = await supabase
    .from('users')
    .select('name')
    .eq('id', auth.userId)
    .single();

  const userName = userRow?.name || 'Utilizator';

  // Verifică dacă există deja un rând în clients pentru acest utilizator
  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('user_id', auth.userId)
    .is('trainer_id', null)
    .maybeSingle();

  let clientId;

  if (existingClient) {
    // Actualizează datele existente
    const { data: updated, error: updateError } = await supabase
      .from('clients')
      .update({
        name: userName,
        age: ageNum,
        weight: weightNum,
        height: heightNum,
        gender: genderNorm,
        fitness_level: fitnessLevel,
        available_equipment: availableEquipment,
        workouts_per_week: workoutsNum,
        training_split: trainingSplit,
        fitness_goal: goal,
        goal: goal,
        activity_level: activityLevel,
        diet_type: dietTypeSafe,
        meals_per_day: 3,
        food_preferences: '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingClient.id)
      .select('id')
      .single();

    if (updateError) {
      console.error('[onboarding] update error:', updateError);
      return NextResponse.json({ error: 'Eroare la actualizarea profilului.' }, { status: 500 });
    }
    clientId = updated.id;
  } else {
    // Creează un rând nou în clients
    const { data: inserted, error: insertError } = await supabase
      .from('clients')
      .insert({
        user_id: auth.userId,
        trainer_id: null,
        name: userName,
        age: ageNum,
        weight: weightNum,
        height: heightNum,
        gender: genderNorm,
        fitness_level: fitnessLevel,
        available_equipment: availableEquipment,
        workouts_per_week: workoutsNum,
        training_split: trainingSplit,
        fitness_goal: goal,
        goal: goal,
        activity_level: activityLevel,
        diet_type: dietTypeSafe,
        meals_per_day: 3,
        food_preferences: '',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[onboarding] insert error:', insertError);
      return NextResponse.json({ error: 'Eroare la crearea profilului.' }, { status: 500 });
    }
    clientId = inserted.id;
  }

  return NextResponse.json({ clientId, success: true });
}

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== 'user') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const supabase = getSupabase();
  const { data: clientRow } = await supabase
    .from('clients')
    .select('id')
    .eq('user_id', auth.userId)
    .is('trainer_id', null)
    .maybeSingle();

  return NextResponse.json({ onboarding_completed: !!clientRow, clientId: clientRow?.id || null });
}
