import { getSupabase } from '@/app/lib/supabase';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { sanitizeEmail } from '@/app/lib/sanitize';
import { getJwtSecret } from '@/app/lib/jwtSecret';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';
import { resolveUserOnboardingCompletion } from '@/app/lib/onboardingStatus';

const AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
const MAX_SIGNIN_BODY_BYTES = 8 * 1024;

function requestBodyTooLarge(request, maxBytes) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

const validateEmail = (email) => {
  if (!email) return 'Adresa de email este obligatorie';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Format de email invalid';
  return null;
};

const validatePassword = (password) => {
  if (!password) return 'Parola este obligatorie';
  return null;
};

export async function POST(request) {
  const supabase = getSupabase();
  const { ip, userAgent } = getRequestMeta(request);

  try {
    if (requestBodyTooLarge(request, MAX_SIGNIN_BODY_BYTES)) {
      return new Response(
        JSON.stringify({ error: 'Body prea mare.' }),
        { status: 413, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();

    let { email, password } = body;

    // Sanitizare email (XSS protection)
    try {
      email = sanitizeEmail(email || '');
    } catch (sanitizeError) {
      await logActivity({ 
        action: 'auth.signin', 
        status: 'failure', 
        email: email || 'unknown', 
        ipAddress: ip, 
        userAgent, 
        details: { reason: 'sanitization_error', message: sanitizeError.message } 
      });
      return new Response(
        JSON.stringify({ error: sanitizeError.message }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    password = password || '';

    // Validate email
    const emailError = validateEmail(email);
    if (emailError) {
      await logActivity({ action: 'auth.signin', status: 'failure', email, ipAddress: ip, userAgent, details: { reason: 'validation_error', field: 'email' } });
      return new Response(
        JSON.stringify({ error: emailError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate password
    const passwordError = validatePassword(password);
    if (passwordError) {
      await logActivity({ action: 'auth.signin', status: 'failure', email, ipAddress: ip, userAgent, details: { reason: 'validation_error', field: 'password' } });
      return new Response(
        JSON.stringify({ error: passwordError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const ipLimit = await enforceRateLimit(request, {
      identifier: `ip:${ip}`,
      endpoint: 'auth-signin-ip',
      maxRequests: 80,
      windowMinutes: 15,
      failClosed: true,
    });
    if (ipLimit) return ipLimit;

    const emailLimit = await enforceRateLimit(request, {
      identifier: `email:${email.toLowerCase()}`,
      endpoint: 'auth-signin-email',
      maxRequests: 10,
      windowMinutes: 15,
      failClosed: true,
    });
    if (emailLimit) {
      await logActivity({ action: 'auth.signin', status: 'blocked', email, ipAddress: ip, userAgent, details: { reason: 'rate_limited' } });
      return emailLimit;
    }

    // Get user from database
    const { data: user, error: dbError } = await supabase
      .from('users')
      .select('id, name, email, password, role, status, account_type, subscription_status, subscription_plan')
      .eq('email', email.toLowerCase())
      .single();

    if (dbError || !user) {
      await logActivity({ action: 'auth.signin', status: 'failure', email, ipAddress: ip, userAgent, details: { reason: 'user_not_found' } });
      return new Response(
        JSON.stringify({ 
          error: 'Email sau parolă incorectă.',
          code: 'INVALID_CREDENTIALS'
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Compare passwords
    let passwordMatch;
    try {
      passwordMatch = await bcrypt.compare(password, user.password);
    } catch (compareError) {
      console.error('Password comparison error:', compareError);
      await logActivity({ action: 'auth.signin', status: 'error', userId: user.id, email, ipAddress: ip, userAgent, details: { reason: 'bcrypt_error' } });
      return new Response(
        JSON.stringify({ error: 'Autentificare eșuată. Încearcă din nou.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!passwordMatch) {
      await logActivity({ action: 'auth.signin', status: 'failure', userId: user.id, email, ipAddress: ip, userAgent, details: { reason: 'wrong_password' } });
      return new Response(
        JSON.stringify({ 
          error: 'Email sau parolă incorectă.',
          code: 'INVALID_CREDENTIALS'
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Block unconfirmed users
    if (user.status === 'pending') {
      await logActivity({ action: 'auth.signin', status: 'failure', userId: user.id, email, ipAddress: ip, userAgent, details: { reason: 'email_not_confirmed' } });
      return new Response(
        JSON.stringify({
          error: 'Confirmă emailul înainte de autentificare. Verifică inbox-ul.',
          code: 'EMAIL_NOT_CONFIRMED'
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const accountType = user.account_type || (user.subscription_status === 'active' ? 'paid' : 'free');
    const subscriptionStatus = user.subscription_status || accountType;

    // Check onboarding completion for B2C users
    let onboardingCompleted = false;
    if (user.role === 'user' || user.role === 'client') {
      onboardingCompleted = await resolveUserOnboardingCompletion(supabase, user.id);
    }

    // Successful login
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        name: user.name,
        role: user.role || 'user',
        account_type: accountType,
        subscription_status: subscriptionStatus,
        subscription_plan: user.subscription_plan || null,
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    await logActivity({ action: 'auth.signin', status: 'success', userId: user.id, email, ipAddress: ip, userAgent });

    const response = new Response(
      JSON.stringify({
        message: 'Autentificare reușită.',
        token,
        user: { 
          id: user.id, 
          name: user.name, 
          email: user.email,
          role: user.role || 'user',
          account_type: accountType,
          subscription_status: subscriptionStatus,
          subscription_plan: user.subscription_plan || null,
          onboarding_completed: onboardingCompleted,
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
    response.headers.append(
      'Set-Cookie',
      [
        `token=${token}`,
        'Path=/',
        `Max-Age=${AUTH_COOKIE_MAX_AGE}`,
        'SameSite=Lax',
        'HttpOnly',
        process.env.NODE_ENV === 'production' ? 'Secure' : '',
      ].filter(Boolean).join('; ')
    );

    return response;
  } catch (error) {
    console.error('Sign in error:', error);

    // Handle JSON parse errors
    if (error instanceof SyntaxError) {
      await logActivity({ action: 'auth.signin', status: 'error', ipAddress: ip, userAgent, details: { reason: 'invalid_json' } });
      return new Response(
        JSON.stringify({ error: 'Format de cerere invalid.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await logActivity({ action: 'auth.signin', status: 'error', ipAddress: ip, userAgent, details: { reason: 'server_error', message: error.message } });
    return new Response(
      JSON.stringify({ error: 'Eroare de server. Încearcă din nou mai târziu.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
