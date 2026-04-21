import { getSupabase } from '@/app/lib/supabase';
import bcrypt from 'bcrypt';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { sanitizeEmail, sanitizeName } from '@/app/lib/sanitize';

// Validation rules
const ValidationRules = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    minLength: 5,
    maxLength: 254,
  },
  password: {
    minLength: 8,
    maxLength: 128,
  },
  name: {
    minLength: 2,
    maxLength: 100,
    pattern: /^[a-zA-Z\s'-]*$/,
  },
};

const validateEmail = (email) => {
  if (!email) return 'Adresa de email este obligatorie';
  if (email.length < ValidationRules.email.minLength) return 'Adresa de email este prea scurtă';
  if (email.length > ValidationRules.email.maxLength) return 'Adresa de email este prea lungă';
  if (!ValidationRules.email.pattern.test(email)) return 'Format de email invalid';
  return null;
};

const validatePassword = (password) => {
  if (!password) return 'Parola este obligatorie';
  if (password.length < ValidationRules.password.minLength) {
    return `Parola trebuie să aibă cel puțin ${ValidationRules.password.minLength} caractere`;
  }
  if (password.length > ValidationRules.password.maxLength) {
    return 'Parola este prea lungă';
  }

  // Check for common weak passwords
  const commonPasswords = ['password', '12345678', 'qwerty123', 'abc123456', 'password123'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    return 'Această parolă este prea comună. Alege o parolă mai puternică';
  }

  return null;
};

const validateName = (name) => {
  if (!name) return 'Numele este obligatoriu';
  const trimmed = name.trim();
  if (trimmed.length < ValidationRules.name.minLength) {
    return `Numele trebuie să aibă cel puțin ${ValidationRules.name.minLength} caractere`;
  }
  if (trimmed.length > ValidationRules.name.maxLength) return 'Numele este prea lung';
  if (!ValidationRules.name.pattern.test(trimmed)) {
    return 'Numele poate conține doar litere, spații, cratime și apostroafe';
  }
  return null;
};

export async function POST(request) {
  const supabase = getSupabase();
  const { ip, userAgent } = getRequestMeta(request);

  // ─── Rate Limiting pentru Signup (previne spam accounts) ───────
  try {
    const { data: rateLimitResult, error: rateLimitError } = await supabase
      .rpc('check_rate_limit', {
        p_user_id: ip || 'unknown',  // Use IP pentru rate limiting înainte de autentificare
        p_endpoint: 'auth-signup',
        p_max_requests: 5,  // Max 5 înregistrări per oră per IP
        p_window_minutes: 60
      });

    if (rateLimitError) {
      console.error('Rate limit check error:', rateLimitError);
    } else if (rateLimitResult && rateLimitResult.length > 0) {
      const { allowed, remaining, reset_at } = rateLimitResult[0];
      
      if (!allowed) {
        const resetDate = new Date(reset_at);
        const minutesRemaining = Math.ceil((resetDate - new Date()) / 60000);
        return new Response(
          JSON.stringify({ error: `Prea multe încercări de înregistrare. Încearcă din nou în ${minutesRemaining} minute.` }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(minutesRemaining * 60) } }
        );
      }
    }
  } catch (err) {
    console.error('Rate limit exception:', err);
  }

  try {
    const body = await request.json();

    let { name, email, password } = body;

    // Sanitizare input-uri (XSS protection)
    try {
      name = sanitizeName(name || '');
      email = sanitizeEmail(email || '');
    } catch (sanitizeError) {
      await logActivity({ 
        action: 'auth.signup', 
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

    // Validate name
    const nameError = validateName(name);
    if (nameError) {
      await logActivity({ action: 'auth.signup', status: 'failure', email, ipAddress: ip, userAgent, details: { reason: 'validation_error', field: 'name' } });
      return new Response(
        JSON.stringify({ error: nameError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate email
    const emailError = validateEmail(email);
    if (emailError) {
      await logActivity({ action: 'auth.signup', status: 'failure', email, ipAddress: ip, userAgent, details: { reason: 'validation_error', field: 'email' } });
      return new Response(
        JSON.stringify({ error: emailError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate password
    const passwordError = validatePassword(password);
    if (passwordError) {
      await logActivity({ action: 'auth.signup', status: 'failure', email, ipAddress: ip, userAgent, details: { reason: 'validation_error', field: 'password' } });
      return new Response(
        JSON.stringify({ error: passwordError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('email')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      await logActivity({ action: 'auth.signup', status: 'failure', email, ipAddress: ip, userAgent, details: { reason: 'email_exists' } });
      return new Response(
        JSON.stringify({ 
          error: 'Email deja înregistrat. Autentifică-te în schimb.',
          code: 'EMAIL_EXISTS'
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Hash password with bcrypt
    let hashedPassword;
    try {
      hashedPassword = await bcrypt.hash(password, 12);
    } catch (hashError) {
      console.error('Bcrypt hashing error:', hashError);
      await logActivity({ action: 'auth.signup', status: 'error', email, ipAddress: ip, userAgent, details: { reason: 'bcrypt_error' } });
      return new Response(
        JSON.stringify({ error: 'Eroare la procesarea parolei. Încearcă din nou.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create user in database
    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          name: name.trim(),
          email: email.toLowerCase(),
          password: hashedPassword,
          created_at: new Date().toISOString(),
        },
      ])
      .select('id, name, email, created_at');

    if (error) {
      console.error('Database error:', error);
      
      // Handle duplicate email error from database
      if (error.code === '23505') {
        await logActivity({ action: 'auth.signup', status: 'failure', email, ipAddress: ip, userAgent, details: { reason: 'email_exists_db' } });
        return new Response(
          JSON.stringify({ 
            error: 'Email deja înregistrat. Autentifică-te în schimb.',
            code: 'EMAIL_EXISTS'
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }

      await logActivity({ action: 'auth.signup', status: 'error', email, ipAddress: ip, userAgent, details: { reason: 'db_error', code: error.code } });
      return new Response(
        JSON.stringify({ error: 'Crearea contului a eșuat. Încearcă din nou.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!data || data.length === 0) {
      await logActivity({ action: 'auth.signup', status: 'error', email, ipAddress: ip, userAgent, details: { reason: 'empty_response' } });
      return new Response(
        JSON.stringify({ error: 'Crearea contului a eșuat. Încearcă din nou.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await logActivity({ action: 'auth.signup', status: 'success', userId: data[0].id, email, ipAddress: ip, userAgent });

    return new Response(
      JSON.stringify({ 
        message: 'Cont creat cu succes.',
        user: {
          id: data[0].id,
          name: data[0].name,
          email: data[0].email,
        }
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sign up error:', error);
    
    // Handle JSON parse errors
    if (error instanceof SyntaxError) {
      await logActivity({ action: 'auth.signup', status: 'error', ipAddress: ip, userAgent, details: { reason: 'invalid_json' } });
      return new Response(
        JSON.stringify({ error: 'Format de cerere invalid.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await logActivity({ action: 'auth.signup', status: 'error', ipAddress: ip, userAgent, details: { reason: 'server_error', message: error.message } });
    return new Response(
      JSON.stringify({ error: 'Eroare de server. Încearcă din nou mai târziu.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
