import { getSupabase } from '@/app/lib/supabase';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { sanitizeEmail } from '@/app/lib/sanitize';
import { getJwtSecret } from '@/app/lib/jwtSecret';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

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
      maxRequests: 30,
      windowMinutes: 15,
    });
    if (ipLimit) return ipLimit;

    const emailLimit = await enforceRateLimit(request, {
      identifier: `email:${email.toLowerCase()}`,
      endpoint: 'auth-signin-email',
      maxRequests: 10,
      windowMinutes: 15,
    });
    if (emailLimit) {
      await logActivity({ action: 'auth.signin', status: 'blocked', email, ipAddress: ip, userAgent, details: { reason: 'rate_limited' } });
      return emailLimit;
    }

    // Get user from database
    const { data: user, error: dbError } = await supabase
      .from('users')
      .select('id, name, email, password, role, status, subscription_status, subscription_plan, trial_ends_at')
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

    // Check onboarding completion for 'user' role
    let onboardingCompleted = false;
    if (user.role === 'user') {
      const { data: clientRow } = await supabase
        .from('clients')
        .select('id')
        .eq('user_id', user.id)
        .is('trainer_id', null)
        .maybeSingle();
      onboardingCompleted = !!clientRow;
    }

    // Successful login
    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        name: user.name,
        role: user.role,
        subscription_status: user.subscription_status || 'trial',
        subscription_plan: user.subscription_plan || null,
        trial_ends_at: user.trial_ends_at || null,
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    await logActivity({ action: 'auth.signin', status: 'success', userId: user.id, email, ipAddress: ip, userAgent });

    return new Response(
      JSON.stringify({ 
        message: 'Autentificare reușită.',
        token,
        user: { 
          id: user.id, 
          name: user.name, 
          email: user.email,
          role: user.role,
          subscription_status: user.subscription_status || 'trial',
          subscription_plan: user.subscription_plan || null,
          trial_ends_at: user.trial_ends_at || null,
          onboarding_completed: onboardingCompleted,
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
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
