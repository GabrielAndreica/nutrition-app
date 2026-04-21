import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { sanitizeText, sanitizeNumber } from '@/app/lib/sanitize';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/clients/[id]/weight-history
 * Returnează istoricul greutății pentru un client + calcul automat stagnare
 */
export async function GET(request, { params }) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: clientId } = await params;

  // Construiește query pentru client bazat pe rol
  let clientQuery = supabase
    .from('clients')
    .select('id, name, weight')
    .eq('id', clientId);

  // Dacă e trainer, verifică că clientul aparține trainerului
  if (auth.role === 'trainer') {
    clientQuery = clientQuery.eq('trainer_id', auth.userId);
  }
  // Dacă e client, verifică că accesează propriile date
  else if (auth.role === 'client') {
    clientQuery = clientQuery.eq('user_id', auth.userId);
  } else {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const { data: client, error: clientError } = await clientQuery.single();

  if (clientError || !client) {
    return NextResponse.json({ error: 'Clientul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  // Obține istoricul greutății (ultimele 12 săptămâni)
  const twelveWeeksAgo = new Date();
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84); // 12 săptămâni

  const { data: weightHistory, error: historyError } = await supabase
    .from('weight_history')
    .select('id, weight, recorded_at, notes')
    .eq('client_id', clientId)
    .gte('recorded_at', twelveWeeksAgo.toISOString())
    .order('recorded_at', { ascending: false })
    .limit(20);

  if (historyError) {
    console.error('Eroare la obținerea istoricului:', historyError);
    return NextResponse.json({ error: 'Eroare la obținerea istoricului.' }, { status: 500 });
  }

  // Calculează săptămânile de stagnare
  const stagnationWeeks = calculateStagnationWeeks(weightHistory, client.weight);

  const { ip, userAgent } = getRequestMeta(request);
  logActivity({
    action: 'progress.history_view',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { 
      clientId, 
      clientName: client.name,
      currentWeight: client.weight,
      historyCount: weightHistory?.length || 0,
      stagnationWeeks
    },
  });

  // ─── Optimizare: Cache 20s pentru weight history (data se schimbă rar) ───
  const res = NextResponse.json({
    client: {
      id: client.id,
      name: client.name,
      currentWeight: client.weight,
    },
    weightHistory: weightHistory || [],
    stagnationWeeks,
    stagnationInfo: getStagnationInfo(stagnationWeeks),
  });
  
  res.headers.set('Cache-Control', 'private, max-age=20, stale-while-revalidate=40');
  res.headers.set('Vary', 'Authorization');
  return res;
}

/**
 * POST /api/clients/[id]/weight-history
 * Adaugă o nouă înregistrare de greutate
 */
export async function POST(request, { params }) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: clientId } = await params;

  // ─── Database Rate Limiting ────────────────────────────────
  try {
    const { data: rateLimitResult, error: rateLimitError } = await supabase
      .rpc('check_rate_limit', {
        p_user_id: String(auth.userId),
        p_endpoint: 'update-weight',
        p_max_requests: 100,  // Max 100 actualizări greutate per oră
        p_window_minutes: 60
      });

    if (rateLimitError) {
      console.error('Rate limit check error:', rateLimitError);
    } else if (rateLimitResult && rateLimitResult.length > 0) {
      const { allowed, remaining, reset_at } = rateLimitResult[0];
      
      if (!allowed) {
        const resetDate = new Date(reset_at);
        const minutesRemaining = Math.ceil((resetDate - new Date()) / 60000);
        return NextResponse.json(
          { error: `Ai atins limita de actualizări. Încearcă din nou în ${minutesRemaining} minute.` },
          { status: 429, headers: { 'Retry-After': String(minutesRemaining * 60) } }
        );
      }
    }
  } catch (err) {
    console.error('Rate limit exception:', err);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  let { weight, notes, recordedAt } = body;

  // Sanitizare greutate
  try {
    weight = sanitizeNumber(weight, { min: 20, max: 300 });
  } catch (err) {
    return NextResponse.json({ error: 'Greutate invalidă: ' + err.message }, { status: 400 });
  }

  // Sanitizare notes (previne XSS)
  if (notes) {
    notes = sanitizeText(notes).slice(0, 1000);
  }

  // Construiește query pentru client bazat pe rol
  let clientQuery = supabase
    .from('clients')
    .select('id')
    .eq('id', clientId);

  // Dacă e trainer, verifică că clientul aparține trainerului
  if (auth.role === 'trainer') {
    clientQuery = clientQuery.eq('trainer_id', auth.userId);
  }
  // Dacă e client, verifică că modifică propriile date
  else if (auth.role === 'client') {
    clientQuery = clientQuery.eq('user_id', auth.userId);
  } else {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const { data: client, error: clientError } = await clientQuery.single();

  if (clientError || !client) {
    return NextResponse.json({ error: 'Clientul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  // Inserează în istoricul greutății
  const { data: newEntry, error: insertError } = await supabase
    .from('weight_history')
    .insert({
      client_id: clientId,
      weight: weight,
      notes: notes || null,
      recorded_at: recordedAt || new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    console.error('Eroare la inserarea greutății:', insertError);
    const { ip, userAgent } = getRequestMeta(request);
    logActivity({
      action: 'progress.weight_record',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { 
        clientId, 
        weight: weight,
        error: insertError.message
      },
    });
    return NextResponse.json({ error: 'Eroare la salvarea greutății.' }, { status: 500 });
  }

  // Actualizăm greutatea clientului + setăm has_new_progress=true când clientul trimite progres
  const clientUpdate = { weight: weight };
  if (auth.role === 'client') {
    clientUpdate.has_new_progress = true;
  }
  const { error: updateError } = await supabase
    .from('clients')
    .update(clientUpdate)
    .eq('id', clientId);

  if (updateError) {
    console.error('Eroare la actualizarea greutății clientului:', updateError);
  } else {
    console.log(`✅ Greutate actualizată pentru client ${clientId}: ${weight}kg${auth.role === 'client' ? ' + has_new_progress=true' : ''}`);
  }

  // Creează notificare pentru trainer dacă progesul a fost adăugat de client
  if (auth.role === 'client') {
    // Obține informații despre client și trainer_id
    const { data: clientData, error: clientDataError } = await supabase
      .from('clients')
      .select('name, trainer_id')
      .eq('id', clientId)
      .single();

    if (!clientDataError && clientData && clientData.trainer_id) {
      // Creează notificare pentru trainer (folosim integer trainer_id)
      const { error: notificationError } = await supabase
        .from('notifications')
        .insert({
          user_id: clientData.trainer_id,
          type: 'progress_update',
          title: 'Progres nou',
          message: `${clientData.name} tocmai și-a actualizat progresul`,
          related_client_id: clientId,
          is_read: false
        });

      if (notificationError) {
        console.error('Eroare la crearea notificării:', notificationError);
        // Nu returnăm eroare, progresul s-a salvat cu succes
      } else {
        console.log(`✅ Notificare creată pentru trainer ${clientData.trainer_id}`);
      }
    }
  }

  // Creează notificare pentru client dacă progresul a fost adăugat de trainer
  if (auth.role === 'trainer') {
    // Obține informații despre client și user_id
    const { data: clientData, error: clientDataError } = await supabase
      .from('clients')
      .select('name, user_id, trainer_id')
      .eq('id', clientId)
      .single();

    if (!clientDataError && clientData && clientData.user_id) {
      // Creează notificare pentru client (folosim integer user_id)
      const { error: notificationError } = await supabase
        .from('notifications')
        .insert({
          user_id: clientData.user_id,
          type: 'progress_update',
          title: 'Progres actualizat',
          message: `Antrenorul tău ți-a actualizat progresul`,
          related_client_id: clientId,
          is_read: false
        });

      if (notificationError) {
        console.error('Eroare la crearea notificării pentru client:', notificationError);
        // Nu returnăm eroare, progresul s-a salvat cu succes
      } else {
        console.log(`✅ Notificare creată pentru client ${clientData.user_id}`);
      }
    }
  }

  const { ip, userAgent } = getRequestMeta(request);
  logActivity({
    action: 'progress.weight_record',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { 
      clientId,
      newWeight: parseFloat(weight),
      notes: notes || null,
      entryId: newEntry.id
    },
  });

  return NextResponse.json({
    success: true,
    entry: newEntry,
  });
}

/**
 * Calculează numărul de săptămâni consecutive cu greutate stabilă
 * Stagnare = variație < 0.5% între săptămâni consecutive
 */
function calculateStagnationWeeks(weightHistory, currentWeight) {
  if (!weightHistory || weightHistory.length === 0) {
    return 0;
  }

  // Grupează înregistrările pe săptămâni
  const weeklyWeights = groupByWeek(weightHistory);
  
  if (weeklyWeights.length < 2) {
    return 0;
  }

  let stagnationWeeks = 0;
  const STAGNATION_THRESHOLD = 0.5; // 0.5% variație = stagnare

  // Parcurge săptămânile de la cea mai recentă
  for (let i = 0; i < weeklyWeights.length - 1; i++) {
    const currentWeekAvg = weeklyWeights[i].avgWeight;
    const previousWeekAvg = weeklyWeights[i + 1].avgWeight;
    
    const changePercent = Math.abs((currentWeekAvg - previousWeekAvg) / previousWeekAvg * 100);
    
    if (changePercent <= STAGNATION_THRESHOLD) {
      stagnationWeeks++;
    } else {
      // Dacă s-a întrerupt stagnarea, oprim numărătoarea
      break;
    }
  }

  return stagnationWeeks;
}

/**
 * Grupează înregistrările de greutate pe săptămâni și calculează media
 */
function groupByWeek(weightHistory) {
  const weeks = {};
  
  weightHistory.forEach(entry => {
    const date = new Date(entry.recorded_at);
    // Obține începutul săptămânii (Luni)
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay() + (date.getDay() === 0 ? -6 : 1));
    const weekKey = weekStart.toISOString().split('T')[0];
    
    if (!weeks[weekKey]) {
      weeks[weekKey] = {
        weekStart: weekKey,
        weights: [],
      };
    }
    weeks[weekKey].weights.push(parseFloat(entry.weight));
  });

  // Calculează media pentru fiecare săptămână și sortează descrescător
  return Object.values(weeks)
    .map(week => ({
      weekStart: week.weekStart,
      avgWeight: week.weights.reduce((a, b) => a + b, 0) / week.weights.length,
      count: week.weights.length,
    }))
    .sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart));
}

/**
 * Returnează informații despre stagnare pentru UI
 */
function getStagnationInfo(weeks) {
  if (weeks === 0) {
    return {
      status: 'progressing',
      message: 'Progres activ - greutatea se modifică conform așteptărilor.',
      color: 'green',
    };
  } else if (weeks === 1) {
    return {
      status: 'monitoring',
      message: '1 săptămână fără schimbare semnificativă. Continuă monitorizarea.',
      color: 'yellow',
    };
  } else if (weeks >= 2) {
    return {
      status: 'stagnation',
      message: `${weeks} săptămâni de stagnare detectate. Recomandată ajustare plan.`,
      color: 'red',
    };
  }
  return { status: 'unknown', message: '', color: 'gray' };
}
