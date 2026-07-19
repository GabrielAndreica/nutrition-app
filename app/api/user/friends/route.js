import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { getLevelInfo } from '@/app/api/user/level/route';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

const MAX_FRIEND_INVITE_BODY_BYTES = 4 * 1024;

function isClientUser(role) {
  return role === 'client' || role === 'user';
}

function requestBodyTooLarge(request, maxBytes) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

function getFriendId(row, userId) {
  return Number(row.user_id) === Number(userId)
    ? Number(row.friend_user_id)
    : Number(row.user_id);
}

function getInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'P';
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join('');
}

function normalizeSearchQuery(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60);
}

function formatUserName(value) {
  return String(value || 'Utilizator').trim().replace(/\s+/g, ' ');
}

function formatPublicUser(row) {
  const levelInfo = getLevelInfo(Number(row?.xp) || 0);
  return {
    userId: Number(row.id),
    name: formatUserName(row.name),
    initials: getInitials(formatUserName(row.name)),
    level: Number(row.level) || levelInfo.level,
    totalXp: levelInfo.totalXp,
    streakCount: Math.max(0, Number(row.streak_count) || 0),
  };
}

export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-friends-get',
    maxRequests: 60,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  const { searchParams } = new URL(request.url);
  const searchQuery = normalizeSearchQuery(searchParams.get('q'));
  const supabase = getSupabase();
  const userId = Number(auth.userId);

  const { data: friendships, error: friendshipError } = await supabase
    .from('user_friendships')
    .select('id, user_id, friend_user_id, status, created_at, accepted_at')
    .or(`user_id.eq.${userId},friend_user_id.eq.${userId}`)
    .order('accepted_at', { ascending: false, nullsFirst: false })
    .limit(100);

  if (friendshipError) {
    const missingTable = friendshipError.code === '42P01'
      || /user_friendships|relation .* does not exist/i.test(String(friendshipError.message || ''));
    if (missingTable) {
      return NextResponse.json({ friends: [], setupRequired: true });
    }
    console.error('[user/friends] friendships error:', friendshipError);
    return NextResponse.json({ error: 'Nu am putut încărca prietenii.' }, { status: 500 });
  }

  if (searchQuery) {
    if (searchQuery.length < 2) {
      return NextResponse.json({ users: [] });
    }

    const relationsByUserId = new Map((friendships || [])
      .map(row => {
        const relatedUserId = getFriendId(row, userId);
        if (!Number.isInteger(relatedUserId) || relatedUserId <= 0) return null;
        const direction = Number(row.user_id) === userId ? 'outgoing' : 'incoming';
        return [relatedUserId, {
          friendshipId: String(row.id),
          status: row.status,
          direction,
        }];
      })
      .filter(Boolean));

    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, level, xp, streak_count')
      .ilike('name', `%${searchQuery}%`)
      .eq('onboarding_completed', true)
      .limit(12);

    if (usersError) {
      console.error('[user/friends] search error:', usersError);
      return NextResponse.json({ error: 'Nu am putut căuta utilizatori.' }, { status: 500 });
    }

    const results = (users || [])
      .filter(row => Number(row.id) !== userId)
      .map(row => {
        const relation = relationsByUserId.get(Number(row.id));
        return {
          ...formatPublicUser(row),
          friendshipId: relation?.friendshipId || null,
          relationStatus: relation?.status === 'accepted'
            ? 'accepted'
            : relation?.status === 'pending'
            ? (relation.direction === 'outgoing' ? 'pending_outgoing' : 'pending_incoming')
            : 'none',
        };
      })
      .filter(Boolean)
      .slice(0, 8);

    return NextResponse.json({ users: results });
  }

  const acceptedFriendships = (friendships || []).filter(row => row.status === 'accepted');
  const incomingFriendships = (friendships || []).filter(row =>
    row.status === 'pending' && Number(row.friend_user_id) === userId
  );
  const outgoingFriendships = (friendships || []).filter(row =>
    row.status === 'pending' && Number(row.user_id) === userId
  );

  const profileIds = [...new Set([
    ...acceptedFriendships.map(row => getFriendId(row, userId)),
    ...incomingFriendships.map(row => Number(row.user_id)),
    ...outgoingFriendships.map(row => Number(row.friend_user_id)),
  ]
    .filter(id => Number.isInteger(id) && id > 0 && id !== userId))];

  if (profileIds.length === 0) {
    return NextResponse.json({ friends: [], incomingRequests: [], outgoingRequests: [] });
  }

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, name, level, xp, streak_count')
    .in('id', profileIds);

  if (usersError) {
    console.error('[user/friends] users error:', usersError);
    return NextResponse.json({ error: 'Nu am putut încărca profilurile prietenilor.' }, { status: 500 });
  }

  const usersById = new Map((users || []).map(row => [Number(row.id), row]));
  const incomingRequests = incomingFriendships
    .map(row => {
      const requester = usersById.get(Number(row.user_id));
      if (!requester) return null;
      const publicUser = formatPublicUser(requester);
      return {
        id: String(row.id),
        ...publicUser,
        requestedAt: row.created_at || null,
      };
    })
    .filter(Boolean);

  const outgoingRequests = outgoingFriendships
    .map(row => {
      const requestedUser = usersById.get(Number(row.friend_user_id));
      if (!requestedUser) return null;
      const publicUser = formatPublicUser(requestedUser);
      return {
        id: String(row.id),
        ...publicUser,
        requestedAt: row.created_at || null,
      };
    })
    .filter(Boolean);

  const friends = acceptedFriendships
    .map(row => {
      const friendId = getFriendId(row, userId);
      const friend = usersById.get(friendId);
      if (!friend) return null;
      const levelInfo = getLevelInfo(Number(friend.xp) || 0);
      return {
        id: String(row.id),
        userId: friendId,
        name: formatUserName(friend.name || 'Prieten'),
        initials: getInitials(formatUserName(friend.name || 'Prieten')),
        level: Number(friend.level) || levelInfo.level,
        totalXp: levelInfo.totalXp,
        streakCount: Math.max(0, Number(friend.streak_count) || 0),
        friendsSince: row.accepted_at || row.created_at || null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ friends, incomingRequests, outgoingRequests });
}

export async function POST(request) {
  const { ip, userAgent } = getRequestMeta(request);
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-friends-invite',
    maxRequests: 20,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  if (requestBodyTooLarge(request, MAX_FRIEND_INVITE_BODY_BYTES)) {
    return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const userId = Number(auth.userId);
  const friendUserId = Number(body?.friendUserId);
  if (!Number.isInteger(friendUserId) || friendUserId <= 0 || friendUserId === userId) {
    return NextResponse.json({ error: 'Utilizator invalid.' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: targetUser, error: targetError } = await supabase
    .from('users')
    .select('id, name')
    .eq('id', friendUserId)
    .maybeSingle();

  if (targetError) {
    console.error('[user/friends] target lookup error:', targetError);
    return NextResponse.json({ error: 'Nu am putut verifica utilizatorul.' }, { status: 500 });
  }
  if (!targetUser) {
    return NextResponse.json({ error: 'Utilizatorul nu există.' }, { status: 404 });
  }

  const { data: currentUser } = await supabase
    .from('users')
    .select('id, name')
    .eq('id', userId)
    .maybeSingle();

  const { data: existingRows, error: existingError } = await supabase
    .from('user_friendships')
    .select('id, user_id, friend_user_id, status')
    .or(`and(user_id.eq.${userId},friend_user_id.eq.${friendUserId}),and(user_id.eq.${friendUserId},friend_user_id.eq.${userId})`)
    .limit(1);

  if (existingError) {
    const missingTable = existingError.code === '42P01'
      || /user_friendships|relation .* does not exist/i.test(String(existingError.message || ''));
    if (missingTable) {
      return NextResponse.json({ error: 'Modulul de prieteni nu este activat încă.' }, { status: 409 });
    }
    console.error('[user/friends] existing lookup error:', existingError);
    return NextResponse.json({ error: 'Nu am putut verifica invitația.' }, { status: 500 });
  }

  const existing = existingRows?.[0];
  if (existing?.status === 'accepted') {
    return NextResponse.json({ message: 'Sunteți deja prieteni.', status: 'accepted' });
  }
  if (existing?.status === 'pending') {
    if (Number(existing.friend_user_id) === userId) {
      const { error: acceptError } = await supabase
        .from('user_friendships')
        .update({ status: 'accepted' })
        .eq('id', existing.id);

      if (acceptError) {
        console.error('[user/friends] accept reciprocal error:', acceptError);
        return NextResponse.json({ error: 'Nu am putut accepta invitația existentă.' }, { status: 500 });
      }
      await logActivity({
        action: 'friends.request_accepted',
        status: 'success',
        userId,
        email: auth.email,
        ipAddress: ip,
        userAgent,
        details: {
          friendshipId: String(existing.id),
          friendUserId,
          source: 'reciprocal_invite',
        },
      });
      return NextResponse.json({ message: 'Prieten adăugat.', status: 'accepted', friendshipId: String(existing.id) });
    }

    return NextResponse.json({ message: 'Invitația este deja trimisă.', status: 'pending', friendshipId: String(existing.id) });
  }

  const { data: insertedFriendship, error: insertError } = await supabase
    .from('user_friendships')
    .insert({
      user_id: userId,
      friend_user_id: friendUserId,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[user/friends] invite insert error:', insertError);
    return NextResponse.json({ error: 'Nu am putut trimite invitația.' }, { status: 500 });
  }

  const senderName = formatUserName(currentUser?.name || 'Cineva');
  const { error: notificationError } = await supabase
    .from('notifications')
    .insert({
      user_id: friendUserId,
      type: 'friend_request',
      title: 'Cerere nouă de prietenie',
      message: `${senderName} vrea să te adauge în lista de prieteni.`,
      related_client_id: insertedFriendship?.id || null,
      is_read: false,
    });

  if (notificationError) {
    console.error('[user/friends] friend request notification error:', notificationError);
  }

  await logActivity({
    action: 'friends.request_sent',
    status: 'success',
    userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: {
      friendshipId: insertedFriendship?.id ? String(insertedFriendship.id) : null,
      friendUserId,
      notificationCreated: !notificationError,
    },
  });

  return NextResponse.json({
    message: 'Invitație trimisă.',
    status: 'pending',
    friendshipId: insertedFriendship?.id ? String(insertedFriendship.id) : null,
  }, { status: 201 });
}

export async function PATCH(request) {
  const { ip, userAgent } = getRequestMeta(request);
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-friends-respond',
    maxRequests: 30,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  if (requestBodyTooLarge(request, MAX_FRIEND_INVITE_BODY_BYTES)) {
    return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const userId = Number(auth.userId);
  const friendshipId = Number(body?.friendshipId);
  const action = String(body?.action || '').trim();
  if (!Number.isInteger(friendshipId) || friendshipId <= 0 || !['accept', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Cerere invalidă.' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: friendship, error: friendshipError } = await supabase
    .from('user_friendships')
    .select('id, user_id, friend_user_id, status')
    .eq('id', friendshipId)
    .maybeSingle();

  if (friendshipError) {
    console.error('[user/friends] respond lookup error:', friendshipError);
    return NextResponse.json({ error: 'Nu am putut verifica cererea.' }, { status: 500 });
  }
  if (!friendship || Number(friendship.friend_user_id) !== userId || friendship.status !== 'pending') {
    return NextResponse.json({ error: 'Cererea nu mai este disponibilă.' }, { status: 404 });
  }

  if (action === 'reject') {
    const { error: deleteError } = await supabase
      .from('user_friendships')
      .delete()
      .eq('id', friendshipId)
      .eq('friend_user_id', userId)
      .eq('status', 'pending');

    if (deleteError) {
      console.error('[user/friends] reject error:', deleteError);
      return NextResponse.json({ error: 'Nu am putut respinge cererea.' }, { status: 500 });
    }

    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('type', 'friend_request')
      .eq('related_client_id', friendshipId);

    await logActivity({
      action: 'friends.request_rejected',
      status: 'success',
      userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: {
        friendshipId: String(friendshipId),
        requesterUserId: Number(friendship.user_id),
      },
    });

    return NextResponse.json({ message: 'Cerere respinsă.', status: 'rejected' });
  }

  const { error: acceptError } = await supabase
    .from('user_friendships')
    .update({ status: 'accepted' })
    .eq('id', friendshipId)
    .eq('friend_user_id', userId)
    .eq('status', 'pending');

  if (acceptError) {
    console.error('[user/friends] accept error:', acceptError);
    return NextResponse.json({ error: 'Nu am putut accepta cererea.' }, { status: 500 });
  }

  await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('type', 'friend_request')
    .eq('related_client_id', friendshipId);

  const { data: requester } = await supabase
    .from('users')
    .select('id, name')
    .eq('id', friendship.user_id)
    .maybeSingle();

  const { data: currentUser } = await supabase
    .from('users')
    .select('id, name')
    .eq('id', userId)
    .maybeSingle();

  await supabase
    .from('notifications')
    .insert({
      user_id: Number(friendship.user_id),
      type: 'friend_request_accepted',
      title: 'Cerere acceptată',
      message: `${formatUserName(currentUser?.name || 'Utilizatorul')} ți-a acceptat cererea de prietenie.`,
      related_client_id: friendshipId,
      is_read: false,
    });

  await logActivity({
    action: 'friends.request_accepted',
    status: 'success',
    userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: {
      friendshipId: String(friendshipId),
      requesterUserId: Number(friendship.user_id),
    },
  });

  return NextResponse.json({
    message: 'Cerere acceptată.',
    status: 'accepted',
    friend: requester ? formatPublicUser(requester) : null,
  });
}

export async function DELETE(request) {
  const { ip, userAgent } = getRequestMeta(request);
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isClientUser(auth.role)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'user-friends-delete',
    maxRequests: 20,
    windowMinutes: 1,
    failClosed: true,
  });
  if (rateLimit) return rateLimit;

  if (requestBodyTooLarge(request, MAX_FRIEND_INVITE_BODY_BYTES)) {
    return NextResponse.json({ error: 'Body prea mare.' }, { status: 413 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const userId = Number(auth.userId);
  const friendshipId = Number(body?.friendshipId);
  if (!Number.isInteger(friendshipId) || friendshipId <= 0) {
    return NextResponse.json({ error: 'Prieten invalid.' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: friendship, error: friendshipError } = await supabase
    .from('user_friendships')
    .select('id, user_id, friend_user_id, status')
    .eq('id', friendshipId)
    .maybeSingle();

  if (friendshipError) {
    console.error('[user/friends] delete lookup error:', friendshipError);
    return NextResponse.json({ error: 'Nu am putut verifica prietenia.' }, { status: 500 });
  }

  const isAcceptedFriend = friendship
    && friendship.status === 'accepted'
    && (Number(friendship.user_id) === userId || Number(friendship.friend_user_id) === userId);
  const isOutgoingPendingRequest = friendship
    && friendship.status === 'pending'
    && Number(friendship.user_id) === userId;

  if (!isAcceptedFriend && !isOutgoingPendingRequest) {
    return NextResponse.json({ error: 'Prietenia nu este disponibilă.' }, { status: 404 });
  }

  let deleteQuery = supabase
    .from('user_friendships')
    .delete()
    .eq('id', friendshipId);

  if (isAcceptedFriend) {
    deleteQuery = deleteQuery.eq('status', 'accepted');
  } else {
    deleteQuery = deleteQuery
      .eq('status', 'pending')
      .eq('user_id', userId);
  }

  const { error: deleteError } = await deleteQuery;

  if (deleteError) {
    console.error('[user/friends] delete error:', deleteError);
    return NextResponse.json({
      error: isOutgoingPendingRequest
        ? 'Nu am putut anula invitația.'
        : 'Nu am putut elimina prietenul.',
    }, { status: 500 });
  }

  if (isOutgoingPendingRequest) {
    const { error: notificationDeleteError } = await supabase
      .from('notifications')
      .delete()
      .eq('type', 'friend_request')
      .eq('related_client_id', friendshipId);

    if (notificationDeleteError) {
      console.error('[user/friends] cancel notification cleanup error:', notificationDeleteError);
    }
  }

  await logActivity({
    action: isOutgoingPendingRequest ? 'friends.request_cancelled' : 'friends.removed',
    status: 'success',
    userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: {
      friendshipId: String(friendshipId),
      otherUserId: getFriendId(friendship, userId),
    },
  });

  return NextResponse.json({
    message: isOutgoingPendingRequest ? 'Invitație anulată.' : 'Prieten eliminat.',
    status: isOutgoingPendingRequest ? 'cancelled' : 'removed',
  });
}
