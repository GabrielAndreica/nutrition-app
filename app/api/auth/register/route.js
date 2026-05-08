import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import bcrypt from 'bcrypt';
import { Resend } from 'resend';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import { sanitizeEmail, sanitizeName } from '@/app/lib/sanitize';

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Validation helpers ──────────────────────────────────────────────────────

const validateName = (name) => {
  if (!name || name.trim().length < 2) return 'Numele trebuie să aibă cel puțin 2 caractere.';
  if (name.trim().length > 100) return 'Numele este prea lung.';
  if (!/^[a-zA-ZÀ-ÖØ-öø-ÿ\s'-]+$/.test(name.trim())) return 'Numele poate conține doar litere, spații, cratime și apostroafe.';
  return null;
};

const validateEmail = (email) => {
  if (!email) return 'Adresa de email este obligatorie.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Format de email invalid.';
  if (email.length > 254) return 'Adresa de email este prea lungă.';
  return null;
};

const validatePassword = (password) => {
  if (!password) return 'Parola este obligatorie.';
  if (password.length < 8) return 'Parola trebuie să aibă cel puțin 8 caractere.';
  if (password.length > 128) return 'Parola este prea lungă.';
  const weak = ['password', '12345678', 'qwerty123', 'abc123456', 'password123'];
  if (weak.some((w) => password.toLowerCase().includes(w))) return 'Această parolă este prea comună.';
  return null;
};

const validatePhone = (phone) => {
  if (!phone) return null; // optional
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return 'Număr de telefon invalid.';
  return null;
};

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(request) {
  const supabase = getSupabase();
  const { ip, userAgent } = getRequestMeta(request);

  // Rate limit: max 3 înregistrări per zi per IP
  try {
    const { data: rl } = await supabase.rpc('check_rate_limit', {
      p_user_id: ip || 'unknown',
      p_endpoint: 'auth-register',
      p_max_requests: 3,
      p_window_minutes: 1440, // 24 ore
    });
    if (rl?.[0]?.allowed === false) {
      const mins = Math.ceil((new Date(rl[0].reset_at) - new Date()) / 60000);
      const hours = Math.ceil(mins / 60);
      return NextResponse.json(
        { error: `Prea multe conturi create din această rețea. Încearcă din nou în ${hours} ${hours === 1 ? 'oră' : 'ore'}.` },
        { status: 429 }
      );
    }
  } catch (e) {
    console.error('[register] rate-limit error:', e);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  let { name, email, password, phone, terms, privacy } = body;

  // Sanitize
  try {
    name = sanitizeName(name || '');
    email = sanitizeEmail(email || '');
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  password = password || '';
  phone = phone?.trim() || '';

  // Validate
  const nameErr = validateName(name);
  if (nameErr) return NextResponse.json({ error: nameErr, field: 'name' }, { status: 400 });

  const emailErr = validateEmail(email);
  if (emailErr) return NextResponse.json({ error: emailErr, field: 'email' }, { status: 400 });

  const passErr = validatePassword(password);
  if (passErr) return NextResponse.json({ error: passErr, field: 'password' }, { status: 400 });

  const phoneErr = validatePhone(phone);
  if (phoneErr) return NextResponse.json({ error: phoneErr, field: 'phone' }, { status: 400 });

  if (!terms) return NextResponse.json({ error: 'Trebuie să accepți termenii și condițiile.', field: 'terms' }, { status: 400 });
  if (!privacy) return NextResponse.json({ error: 'Trebuie să accepți politica de confidențialitate.', field: 'privacy' }, { status: 400 });

  // Check existing email
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing) {
    await logActivity({ action: 'auth.register', status: 'failure', email, ipAddress: ip, userAgent, details: { reason: 'email_exists' } });
    return NextResponse.json(
      { error: 'Există deja un cont cu această adresă de email.', field: 'email', code: 'EMAIL_EXISTS' },
      { status: 409 }
    );
  }

  // Hash password
  let hashedPassword;
  try {
    hashedPassword = await bcrypt.hash(password, 12);
  } catch (e) {
    console.error('[register] bcrypt error:', e);
    return NextResponse.json({ error: 'Eroare la procesarea parolei.' }, { status: 500 });
  }

  // Generate confirmation token
  const confirmationToken = crypto.randomUUID();
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

  // Insert user
  const insertPayload = {
    name: name.trim(),
    email: email.toLowerCase(),
    password: hashedPassword,
    status: 'pending',
    confirmation_token: confirmationToken,
    confirmation_token_expires_at: tokenExpiresAt,
    created_at: new Date().toISOString(),
  };
  if (phone) insertPayload.phone = phone;

  const { data: newUser, error: insertError } = await supabase
    .from('users')
    .insert([insertPayload])
    .select('id, name, email')
    .single();

  if (insertError) {
    console.error('[register] insert error:', insertError);
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'Există deja un cont cu această adresă de email.', field: 'email', code: 'EMAIL_EXISTS' },
        { status: 409 }
      );
    }
    await logActivity({ action: 'auth.register', status: 'error', email, ipAddress: ip, userAgent, details: { reason: 'db_error', code: insertError.code } });
    return NextResponse.json({ error: 'Crearea contului a eșuat. Încearcă din nou.' }, { status: 500 });
  }

  // Send confirmation email
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const confirmLink = `${appUrl}/confirm/${confirmationToken}`;

  try {
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: 'trevano <noreply@trevano.app>',
      to: newUser.email,
      subject: 'Confirmă-ți adresa de email — trevano',
      html: `
        <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #fff;">
          <div style="margin-bottom: 32px;">
            <span style="display: inline-block; width: 34px; height: 34px; background: #b7ff00; border-radius: 8px; text-align: center; line-height: 34px; font-family: 'Space Grotesk', Inter, sans-serif; font-size: 17px; font-weight: 700; color: #000;">t</span>
            <span style="font-family: 'Space Grotesk', Inter, sans-serif; font-size: 17px; font-weight: 700; color: #0a0a0a; margin-left: 10px; vertical-align: middle;">trevano</span>
          </div>
          <h1 style="font-size: 22px; font-weight: 800; color: #0a0a0a; letter-spacing: -0.5px; margin: 0 0 8px;">Confirmă adresa de email</h1>
          <p style="font-size: 15px; color: #555; line-height: 1.6; margin: 0 0 28px;">
            Bună, ${newUser.name}!<br/>
            Cont creat cu succes. Apasă butonul de mai jos pentru a-ți confirma adresa de email și a activa contul.
          </p>
          <a href="${confirmLink}" style="display: inline-block; padding: 13px 28px; background: #0a0a0a; color: #b7ff00; text-decoration: none; border-radius: 12px; font-size: 15px; font-weight: 700;">
            Confirmă adresa de email
          </a>
          <p style="font-size: 13px; color: #999; margin-top: 28px; line-height: 1.6;">
            Link-ul este valabil timp de <strong>24 de ore</strong>.<br/>
            Dacă nu tu ai creat acest cont, poți ignora acest email.
          </p>
        </div>
      `,
    });

    if (emailError) {
      await logActivity({
        action: 'email.confirmation_send',
        status: 'error',
        userId: newUser.id,
        email: newUser.email,
        ipAddress: ip,
        userAgent,
        details: { provider: 'resend', error: emailError.message || 'resend_error' },
      });
    } else {
      await logActivity({
        action: 'email.confirmation_send',
        status: 'success',
        userId: newUser.id,
        email: newUser.email,
        ipAddress: ip,
        userAgent,
        details: { provider: 'resend', messageId: emailData?.id || null },
      });
    }
  } catch (emailErr) {
    console.error('[register] email send error:', emailErr);
    await logActivity({
      action: 'email.confirmation_send',
      status: 'error',
      userId: newUser.id,
      email: newUser.email,
      ipAddress: ip,
      userAgent,
      details: { provider: 'resend', error: emailErr?.message || 'unknown_email_error' },
    });
    // Don't fail the registration if email fails — user can request resend
  }

  await logActivity({ action: 'auth.register', status: 'success', userId: newUser.id, email: newUser.email, ipAddress: ip, userAgent });

  return NextResponse.json(
    { message: 'Cont creat. Verifică emailul pentru a activa contul.' },
    { status: 201 }
  );
}
