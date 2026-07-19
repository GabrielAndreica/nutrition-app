import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

export async function POST(request, { params }) {
  const { ip, userAgent } = getRequestMeta(request);
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rl = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-recipe-purchase',
    maxRequests: 20,
    windowMinutes: 1,
  });
  if (rl) return rl;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Rețetă invalidă.' }, { status: 400 });

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('purchase_recipe_with_coins', {
    p_user_id: Number(auth.userId),
    p_recipe_id: id,
  });

  if (error) {
    const message = String(error.message || '');
    if (/insufficient balance/i.test(message)) {
      await logActivity({
        action: 'recipe.purchase',
        status: 'blocked',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: {
          recipeId: id,
          reason: 'insufficient_balance',
        },
      });
      return NextResponse.json({ error: 'Nu ai suficiente monede pentru această rețetă.' }, { status: 402 });
    }
    if (/recipe not found/i.test(message)) {
      return NextResponse.json({ error: 'Rețeta nu a fost găsită.' }, { status: 404 });
    }
    console.error('[user/recipes/purchase] purchase error:', error);
    return NextResponse.json({ error: 'Nu am putut cumpăra rețeta.' }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  await logActivity({
    action: 'recipe.purchase',
    status: result?.already_owned === true ? 'blocked' : 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: {
      recipeId: id,
      alreadyOwned: result?.already_owned === true,
      unlocked: result?.unlocked === true,
      price: Math.max(0, Number(result?.price) || 0),
      balanceAfter: Math.max(0, Number(result?.balance) || 0),
    },
  });
  return NextResponse.json({
    unlocked: result?.unlocked === true,
    alreadyOwned: result?.already_owned === true,
    appCoins: Math.max(0, Number(result?.balance) || 0),
    price: Math.max(0, Number(result?.price) || 0),
  });
}
