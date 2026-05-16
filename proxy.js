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

// ── API-uri care nu trebuie blocate de subscription check ─────────────────
// (rutele de auth sunt publice; /api/auth/me este apelat DE subscription check)
const PUBLIC_API_PREFIXES = [
  '/api/auth/',      // login, register, confirm, me, signout
  '/api/stripe/webhook',
];

function withSecurityHeaders(response, request) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(self)'
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set(
    'Content-Security-Policy',
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
  );

  if (request.nextUrl.protocol === 'https:' || process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  return response;
}

export function proxy(request) {
  const { pathname } = request.nextUrl;

  // Lasă trece toate API-urile publice (auth, health etc.) — le verifică propria logică
  if (PUBLIC_API_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return withSecurityHeaders(NextResponse.next(), request);
  }

  const token = request.cookies.get('token')?.value;

  const isProtected = PROTECTED_ROUTES.some(route => pathname.startsWith(route));

  // Redirect unauthenticated users → login
  if (isProtected && !token) {
    const loginUrl = new URL('/auth', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return withSecurityHeaders(NextResponse.redirect(loginUrl), request);
  }

  // Nu blocăm rutele protejate pe baza subscription status din JWT.
  // Statusul se schimbă prin Stripe webhook, iar JWT-ul/cookie-ul poate rămâne stale.
  // AuthContext și API-urile fac verificarea live din DB.

  return withSecurityHeaders(NextResponse.next(), request);
}

export const config = {
  matcher: [
    // Exclude fișiere statice și imagine Next.js
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
