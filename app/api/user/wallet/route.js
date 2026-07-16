import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

function isClientUser(role) {
  return role === 'client' || role === 'user';
}

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const rl = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-wallet-get',
    maxRequests: 60,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rl) return rl;

  const supabase = getSupabase();
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('app_coins')
    .eq('id', auth.userId)
    .maybeSingle();

  if (userError) {
    console.error('[user/wallet] user error:', userError);
    return NextResponse.json({ error: 'Nu am putut citi portofelul.' }, { status: 500 });
  }

  const { data: transactions, error: txError } = await supabase
    .from('app_currency_ledger')
    .select('id, amount, balance_after, reason, source_type, source_key, metadata, created_at')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (txError) {
    console.error('[user/wallet] ledger error:', txError);
    return NextResponse.json({ error: 'Nu am putut citi istoricul monedelor.' }, { status: 500 });
  }

  return NextResponse.json({
    appCoins: Math.max(0, Number(userRow?.app_coins) || 0),
    transactions: transactions || [],
  });
}
