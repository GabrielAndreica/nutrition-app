import { NextResponse } from 'next/server';

// ── Rute protejate (necesită auth + subscripție validă) ───────────────────
const PROTECTED_ROUTES = [
  '/dashboard',
  '/clients',
  '/client',
  '/generator-plan',
  '/generator-antrenament',
  '/meal-plan',
  '/workout-plan',
];

// ── Rute publice (nu necesită token) ─────────────────────────────────────
const PUBLIC_ROUTES = ['/', '/landing', '/auth', '/register', '/confirm', '/upgrade'];

// ── API-uri care nu trebuie blocate de subscription check ─────────────────
// (rutele de auth sunt publice; /api/auth/me este apelat DE subscription check)
const PUBLIC_API_PREFIXES = [
  '/api/auth/',      // login, register, confirm, me, signout
];

/**
 * Decode JWT payload fără verificarea semnăturii.
 * Sigur în Edge middleware — citim doar claims, nu validăm.
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64url = parts[1];
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    const json = typeof atob !== 'undefined'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Lasă trece toate API-urile publice (auth, health etc.) — le verifică propria logică
  if (PUBLIC_API_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const token = request.cookies.get('token')?.value;

  const isPublic    = PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'));
  const isProtected = PROTECTED_ROUTES.some(route => pathname.startsWith(route));

  // Redirect unauthenticated users → login
  if (isProtected && !token) {
    const loginUrl = new URL('/auth', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Verifică subscription status din JWT (prima linie de apărare — fără DB)
  // AuthContext face verificarea live din DB la fiecare mount (a doua linie)
  if (isProtected && token) {
    const payload = decodeJwtPayload(token);
    if (payload) {
      const status      = payload.subscription_status;
      const trialEndsAt = payload.trial_ends_at ? new Date(payload.trial_ends_at) : null;

      if (status === 'trial' && trialEndsAt && trialEndsAt < new Date()) {
        return NextResponse.redirect(new URL('/upgrade?reason=trial_expired', request.url));
      }

      if (status === 'cancelled' || status === 'inactive') {
        return NextResponse.redirect(new URL('/upgrade?reason=subscription_inactive', request.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclude fișiere statice și imagine Next.js
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
