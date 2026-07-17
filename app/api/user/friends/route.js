import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { getLevelInfo } from '@/app/api/user/level/route';

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

function formatPublicUser(row) {
  const levelInfo = getLevelInfo(Number(row?.xp) || 0);
  return {
    userId: Number(row.id),
    name: row.name || 'Utilizator',
    initials: getInitials(row.name || 'Utilizator'),
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
    .eq('status', 'accepted')
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

    const relatedIds = new Set((friendships || [])
      .map(row => getFriendId(row, userId))
      .filter(id => Number.isInteger(id) && id > 0));
    relatedIds.add(userId);

    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, name, level, xp, streak_count')
      .ilike('name', `%${searchQuery}%`)
      .limit(12);

    if (usersError) {
      console.error('[user/friends] search error:', usersError);
      return NextResponse.json({ error: 'Nu am putut căuta utilizatori.' }, { status: 500 });
    }

    const results = (users || [])
      .filter(row => !relatedIds.has(Number(row.id)))
      .map(formatPublicUser)
      .slice(0, 8);

    return NextResponse.json({ users: results });
  }

  const friendIds = [...new Set((friendships || [])
    .map(row => getFriendId(row, userId))
    .filter(id => Number.isInteger(id) && id > 0 && id !== userId))];

  if (friendIds.length === 0) {
    return NextResponse.json({ friends: [] });
  }

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, name, level, xp, streak_count')
    .in('id', friendIds);

  if (usersError) {
    console.error('[user/friends] users error:', usersError);
    return NextResponse.json({ error: 'Nu am putut încărca profilurile prietenilor.' }, { status: 500 });
  }

  const usersById = new Map((users || []).map(row => [Number(row.id), row]));
  const friends = (friendships || [])
    .map(row => {
      const friendId = getFriendId(row, userId);
      const friend = usersById.get(friendId);
      if (!friend) return null;
      const levelInfo = getLevelInfo(Number(friend.xp) || 0);
      return {
        id: String(row.id),
        userId: friendId,
        name: friend.name || 'Prieten',
        initials: getInitials(friend.name || 'Prieten'),
        level: Number(friend.level) || levelInfo.level,
        totalXp: levelInfo.totalXp,
        streakCount: Math.max(0, Number(friend.streak_count) || 0),
        friendsSince: row.accepted_at || row.created_at || null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ friends });
}

export async function POST(request) {
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
    .select('id')
    .eq('id', friendUserId)
    .maybeSingle();

  if (targetError) {
    console.error('[user/friends] target lookup error:', targetError);
    return NextResponse.json({ error: 'Nu am putut verifica utilizatorul.' }, { status: 500 });
  }
  if (!targetUser) {
    return NextResponse.json({ error: 'Utilizatorul nu există.' }, { status: 404 });
  }

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
      return NextResponse.json({ message: 'Prieten adăugat.', status: 'accepted' });
    }

    return NextResponse.json({ message: 'Invitația este deja trimisă.', status: 'pending' });
  }

  const { error: insertError } = await supabase
    .from('user_friendships')
    .insert({
      user_id: userId,
      friend_user_id: friendUserId,
      status: 'pending',
    });

  if (insertError) {
    console.error('[user/friends] invite insert error:', insertError);
    return NextResponse.json({ error: 'Nu am putut trimite invitația.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Invitație trimisă.', status: 'pending' }, { status: 201 });
}
