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
  '/api/stripe/webhook',
];

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

  // Nu blocăm rutele protejate pe baza subscription status din JWT.
  // Statusul se schimbă prin Stripe webhook, iar JWT-ul/cookie-ul poate rămâne stale.
  // AuthContext și API-urile fac verificarea live din DB.

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclude fișiere statice și imagine Next.js
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
