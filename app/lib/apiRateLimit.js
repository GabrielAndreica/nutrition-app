import { NextResponse } from 'next/server';
import { getRequestMeta } from '@/app/lib/logger';
import { getSupabase } from '@/app/lib/supabase';

function normalizeIdentifier(value) {
  return String(value || 'unknown').trim().slice(0, 160);
}

export async function enforceRateLimit(request, {
  identifier,
  userId,
  endpoint,
  maxRequests = 60,
  windowMinutes = 1,
  failClosed = false,
} = {}) {
  const { ip } = getRequestMeta(request);
  const rateLimitIdentifier = normalizeIdentifier(
    identifier || (userId ? `user:${userId}` : `ip:${ip}`)
  );
  const rateLimitEndpoint = normalizeIdentifier(endpoint || 'api');

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_user_id: rateLimitIdentifier,
      p_endpoint: rateLimitEndpoint,
      p_max_requests: maxRequests,
      p_window_minutes: windowMinutes,
    });

    if (error) {
      console.error('[RateLimit] Supabase RPC error:', error);
      if (!failClosed) return null;

      return NextResponse.json(
        { error: 'Serviciul este temporar indisponibil. Încearcă din nou.' },
        { status: 503 }
      );
    }

    const result = Array.isArray(data) ? data[0] : data;
    const allowed = typeof result === 'boolean' ? result : result?.allowed;
    const resetAt = result?.reset_at ? new Date(result.reset_at) : null;

    if (allowed === false) {
      const retryAfter = Math.max(1, windowMinutes * 60);
      const resetRetryAfter = resetAt
        ? Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))
        : retryAfter;
      return NextResponse.json(
        { error: 'Prea multe cereri. Încearcă din nou în câteva momente.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(resetRetryAfter),
            'X-RateLimit-Limit': String(maxRequests),
            'X-RateLimit-Window': `${windowMinutes}m`,
          },
        }
      );
    }
  } catch (error) {
    console.error('[RateLimit] Unexpected error:', error);
    if (!failClosed) return null;

    return NextResponse.json(
      { error: 'Serviciul este temporar indisponibil. Încearcă din nou.' },
      { status: 503 }
    );
  }

  return null;
}
