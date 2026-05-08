import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabase } from '@/app/lib/supabase';
import { checkSubscription } from '@/app/lib/checkSubscription';

const REASON_LABELS = {
  meal_plan_generate: 'generarea planului alimentar',
  workout_plan_generate: 'generarea planului de antrenament',
  client_invite: 'trimiterea invitației',
  meal_plan_pdf_export: 'exportul PDF al planului alimentar',
  workout_plan_pdf_export: 'exportul PDF al planului de antrenament',
};

export function hashClientKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function planLabel(subscription) {
  if (subscription.status === 'trial') return 'Trial';
  if (subscription.plan === 'pro') return 'Pro';
  if (subscription.plan === 'starter') return 'Starter';
  return 'abonamentul curent';
}

export function monthlyLimitResponse(subscription, usage, reason) {
  const label = planLabel(subscription);
  const action = REASON_LABELS[reason] || 'această acțiune';
  const limit = usage?.limit ?? subscription.maxClients;
  const used = usage?.used ?? limit;

  return NextResponse.json(
    {
      error: `Ai atins limita de ${limit} clienți/lună pentru planul ${label}. Clientul nu a fost consumat la creare, dar ${action} ar depăși limita.`,
      code: 'CLIENT_MONTHLY_LIMIT_REACHED',
      limit,
      used,
      plan: subscription.plan,
      status: subscription.status,
    },
    { status: 403 }
  );
}

export async function reserveMonthlyClientUsage({
  trainerId,
  clientId,
  reason,
  clientKey = null,
  subscription = null,
}) {
  const sub = subscription || await checkSubscription(trainerId);
  if (!sub.allowed) {
    return { allowed: false, response: sub.response, subscription: sub };
  }

  if (!clientId && !clientKey) {
    return { allowed: true, counted: false, subscription: sub };
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('reserve_monthly_client_usage', {
    p_trainer_id: Number(trainerId),
    p_client_id: clientId || null,
    p_client_key_hash: hashClientKey(clientKey),
    p_reason: reason || 'usage',
    p_max_clients: sub.maxClients,
  });

  if (error) {
    console.error('[clientUsage] reserve_monthly_client_usage failed:', error);
    return {
      allowed: false,
      response: NextResponse.json(
        { error: 'Eroare internă la verificarea limitei de clienți.' },
        { status: 500 }
      ),
      subscription: sub,
    };
  }

  const usage = data || {};
  if (!usage.allowed) {
    return {
      allowed: false,
      usage,
      subscription: sub,
      response: monthlyLimitResponse(sub, usage, reason),
    };
  }

  return {
    allowed: true,
    counted: !!usage.counted,
    alreadyCounted: !!usage.already_counted,
    usage,
    subscription: sub,
  };
}
