import { getSupabase } from '@/app/lib/supabase';
import { NextResponse } from 'next/server';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { sanitizeText, sanitizeNumber } from '@/app/lib/sanitize';

export async function GET(request) {
  const supabase = getSupabase();
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
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
  const supabase = getSupabase();
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const { notification_ids, mark_all } = body;

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

      return NextResponse.json({ message: 'All notifications marked as read' }, { status: 200 });
    }

    if (!notification_ids || !Array.isArray(notification_ids)) {
      return NextResponse.json({ error: 'Invalid notification_ids' }, { status: 400 });
    }

    // Mark specific notifications as read
    const { error: updateError } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .in('id', notification_ids)
      .eq('user_id', auth.userId);

    if (updateError) {
      console.error('Error marking notifications as read:', updateError);
      return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
    }

    return NextResponse.json({ message: 'Notifications marked as read' }, { status: 200 });
  } catch (error) {
    console.error('Notifications PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
  const supabase = getSupabase();
  const auth = verifyToken(request);
  if (auth.error) {
    console.error('[Notifications POST] Auth error:', auth.error);
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    let { user_id, type, title, message, related_client_id, related_plan_id } = body;

    if (!user_id || !type || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Sanitizare input-uri (XSS protection)
    try {
      if (title) title = sanitizeText(title).slice(0, 200);
      message = sanitizeText(message).slice(0, 1000);
      user_id = sanitizeNumber(user_id, { min: 1, max: 999999999, allowFloat: false });
      if (related_client_id) related_client_id = sanitizeNumber(related_client_id, { min: 1, max: 999999999, allowFloat: false });
      if (related_plan_id) related_plan_id = sanitizeNumber(related_plan_id, { min: 1, max: 999999999, allowFloat: false });
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
