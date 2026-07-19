import { getSupabase } from '@/app/lib/supabase';
import { NextResponse } from 'next/server';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { sanitizeText, sanitizeNumber } from '@/app/lib/sanitize';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

const DEFAULT_NOTIFICATION_LIMIT = 20;
const MAX_NOTIFICATION_LIMIT = 50;
const MAX_NOTIFICATION_IDS = 100;
const MAX_NOTIFICATION_ID_LENGTH = 120;
const MAX_NOTIFICATION_BODY_BYTES = 16 * 1024;

function parseNotificationLimit(value) {
  const parsed = Number.parseInt(value || String(DEFAULT_NOTIFICATION_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_NOTIFICATION_LIMIT;
  return Math.min(MAX_NOTIFICATION_LIMIT, Math.max(1, parsed));
}

function requestBodyTooLarge(request) {
  const contentLength = Number.parseInt(request.headers.get('content-length') || '0', 10);
  return Number.isFinite(contentLength) && contentLength > MAX_NOTIFICATION_BODY_BYTES;
}

async function readNotificationJsonBody(request) {
  const bodyText = await request.text();
  if (bodyText.length > MAX_NOTIFICATION_BODY_BYTES) {
    return { tooLarge: true, body: null };
  }

  return { tooLarge: false, body: bodyText ? JSON.parse(bodyText) : {} };
}

function normalizeNotificationIds(value) {
  if (!Array.isArray(value)) return null;

  const ids = [];
  const seen = new Set();

  for (const rawId of value) {
    const id = String(rawId || '').trim();
    if (!id || id.length > MAX_NOTIFICATION_ID_LENGTH || seen.has(id)) continue;

    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_NOTIFICATION_IDS) break;
  }

  return ids.length ? ids : null;
}

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'notifications-get',
    maxRequests: 120,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  try {
    const supabase = getSupabase();
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const limit = parseNotificationLimit(searchParams.get('limit'));
    const unreadOnly = searchParams.get('unread_only') === 'true';

    // Build query using integer user_id
    let query = supabase
      .from('notifications')
      .select(`
        id,
        type,
        title,
        message,
        related_client_id,
        related_plan_id,
        is_read,
        created_at
      `)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data: notifications, error: notificationsError } = await query;

    if (notificationsError) {
      console.error('Error fetching notifications:', notificationsError);
      return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
    }

    return NextResponse.json({ notifications }, { status: 200 });
  } catch (error) {
    console.error('Notifications GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Mark notifications as read
export async function PATCH(request) {
  const { ip, userAgent } = getRequestMeta(request);
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'notifications-patch',
    maxRequests: 60,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  if (requestBodyTooLarge(request)) {
    return NextResponse.json({ error: 'Payload prea mare' }, { status: 413 });
  }

  try {
    const parsedBody = await readNotificationJsonBody(request);
    if (parsedBody.tooLarge) {
      return NextResponse.json({ error: 'Payload prea mare' }, { status: 413 });
    }

    const body = parsedBody.body;
    const { notification_ids, mark_all } = body;
    const supabase = getSupabase();

    if (mark_all) {
      // Mark all notifications as read
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', auth.userId)
        .eq('is_read', false);

      if (updateError) {
        console.error('Error marking all as read:', updateError);
        return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
      }

      await logActivity({
        action: 'notifications.mark_read',
        status: 'success',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: {
          markAll: true,
        },
      });

      return NextResponse.json({ message: 'All notifications marked as read' }, { status: 200 });
    }

    const safeNotificationIds = normalizeNotificationIds(notification_ids);
    if (!safeNotificationIds) {
      return NextResponse.json({ error: 'Invalid notification_ids' }, { status: 400 });
    }

    // Mark specific notifications as read
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .in('id', safeNotificationIds)
      .eq('user_id', auth.userId);

    if (updateError) {
      console.error('Error marking notifications as read:', updateError);
      return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
    }

    await logActivity({
      action: 'notifications.mark_read',
      status: 'success',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: {
        markAll: false,
        count: safeNotificationIds.length,
      },
    });

    return NextResponse.json({ message: 'Notifications marked as read' }, { status: 200 });
  } catch (error) {
    console.error('Notifications PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    console.error('[Notifications POST] Auth error:', auth.error);
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'notifications-post',
    maxRequests: 30,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  if (requestBodyTooLarge(request)) {
    return NextResponse.json({ error: 'Payload prea mare' }, { status: 413 });
  }

  try {
    const parsedBody = await readNotificationJsonBody(request);
    if (parsedBody.tooLarge) {
      return NextResponse.json({ error: 'Payload prea mare' }, { status: 413 });
    }

    const body = parsedBody.body;
    let { user_id, type, title, message, related_client_id, related_plan_id } = body;

    if (!type || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = getSupabase();

    // Pentru notificările către client, user_id este derivat din relația trainer-client.
    if (related_client_id) {
      const { data: clientRow, error: clientErr } = await supabase
        .from('clients')
        .select('user_id, trainer_id')
        .eq('id', related_client_id)
        .single();

      if (clientErr || !clientRow) {
        console.error('[Notifications POST] Client lookup error:', clientErr);
        return NextResponse.json({ error: 'Client negăsit' }, { status: 404 });
      }

      if (String(clientRow.trainer_id) !== String(auth.userId)) {
        return NextResponse.json({ error: 'Nu ai acces la acest client.' }, { status: 403 });
      }

      if (!clientRow.user_id) {
        // Clientul nu are cont activat — notificarea nu poate fi trimisă
        return NextResponse.json({ message: 'Client fără cont activat, notificare ignorată' }, { status: 200 });
      }

      user_id = clientRow.user_id;
    } else if (user_id && String(user_id) !== String(auth.userId)) {
      return NextResponse.json({ error: 'Nu poți crea notificări pentru alt utilizator.' }, { status: 403 });
    }

    if (!user_id) {
      return NextResponse.json({ error: 'Missing user_id or related_client_id' }, { status: 400 });
    }

    // Sanitizare input-uri (XSS protection)
    try {
      if (title) title = sanitizeText(title).slice(0, 200);
      type = sanitizeText(type).slice(0, 80);
      message = sanitizeText(message).slice(0, 1000);
      user_id = sanitizeNumber(user_id, { min: 1, max: 999999999, allowFloat: false });
      // related_client_id și related_plan_id sunt UUID-uri — nu le trecem prin sanitizeNumber
      if (related_client_id && typeof related_client_id !== 'string') {
        related_client_id = String(related_client_id);
      }
      if (related_plan_id && typeof related_plan_id !== 'string') {
        related_plan_id = String(related_plan_id);
      }
    } catch (sanitizeError) {
      return NextResponse.json({ error: 'Date invalide: ' + sanitizeError.message }, { status: 400 });
    }

    const insertData = {
      user_id,
      type,
      title: title || null,
      message,
      related_client_id: related_client_id || null,
      related_plan_id: related_plan_id || null,
      is_read: false
    };

    const { data: notification, error: insertError } = await supabase
      .from('notifications')
      .insert(insertData)
      .select()
      .single();

    if (insertError) {
      console.error('[Notifications POST] Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to create notification', details: insertError.message }, { status: 500 });
    }
    
    // Log pentru acțiunile antrenorului
    const { ip, userAgent } = getRequestMeta(request);
    if (type === 'plan_continued') {
      await logActivity({
        action: 'plan.continued',
        status: 'success',
        userId: auth.userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: { 
          client_id: related_client_id,
          notification_id: notification.id
        }
      });
    }
    
    return NextResponse.json({ notification }, { status: 201 });
  } catch (error) {
    console.error('[Notifications POST] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
