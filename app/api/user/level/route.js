import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

// XP formula: to go from level N to N+1 requires N*100 XP
// Total XP to reach level N (from level 1): N*(N-1)/2 * 100
export function getLevelInfo(xp) {
  const totalXp = Math.max(0, xp || 0);

  // Determine current level from total XP
  // xpForLevel(N) = N*(N-1)/2 * 100
  // Solve: N*(N-1)/2 * 100 <= totalXp
  let level = 1;
  while (((level + 1) * level) / 2 * 100 <= totalXp) {
    level++;
  }

  const xpStartOfLevel = (level * (level - 1)) / 2 * 100;
  const xpForNextLevel = level * 100; // XP needed to advance from current level
  const xpInCurrentLevel = totalXp - xpStartOfLevel;
  const progressPct = Math.min(100, Math.round((xpInCurrentLevel / xpForNextLevel) * 100));

  return {
    level,
    totalXp,
    xpInCurrentLevel,
    xpForNextLevel,
    progressPct,
  };
}

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rl = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-level-get',
    maxRequests: 60,
    windowMinutes: 1,
  });
  if (rl) return rl;

  const supabase = getSupabase();
  const { data: clientRow, error } = await supabase
    .from('users')
    .select('xp, level, app_coins')
    .eq('id', auth.userId)
    .maybeSingle();

  if (error) {
    console.error('[user/level] DB error:', error);
    return NextResponse.json({ error: 'Eroare la citirea nivelului.' }, { status: 500 });
  }

  const xp = clientRow?.xp ?? 0;
  const info = getLevelInfo(xp);

  // Sync level in DB if it drifted
  if (clientRow && clientRow.level !== info.level) {
    await supabase
      .from('users')
      .update({ level: info.level })
      .eq('id', auth.userId);
  }

  return NextResponse.json({
    ...info,
    appCoins: Math.max(0, Number(clientRow?.app_coins) || 0),
  });
}
