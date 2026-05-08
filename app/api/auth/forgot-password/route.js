import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import { logActivity } from '@/app/lib/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const { email } = body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email invalid.' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Check if user exists — always return success to avoid email enumeration
  const { data: user } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (user) {
    // Generate a short-lived reset token (1 hour)
    const resetToken = jwt.sign(
      { userId: user.id, email: user.email, purpose: 'password_reset' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const resetLink = `${appUrl}/auth/reset-password?token=${resetToken}`;

    try {
      await resend.emails.send({
        from: 'trevano <noreply@trevano.app>',
        to: user.email,
        subject: 'Resetare parola — trevano',
        html: `
          <div style="font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #fff;">
            <div style="margin-bottom: 32px;">
              <span style="display: inline-block; width: 34px; height: 34px; background: #b7ff00; border-radius: 8px; text-align: center; line-height: 34px; font-family: 'Space Grotesk', Inter, sans-serif; font-size: 17px; font-weight: 700; color: #000;">t</span>
              <span style="font-family: 'Space Grotesk', Inter, sans-serif; font-size: 17px; font-weight: 700; color: #0a0a0a; margin-left: 10px; vertical-align: middle;">trevano</span>
            </div>
            <h1 style="font-size: 22px; font-weight: 800; color: #0a0a0a; letter-spacing: -0.5px; margin: 0 0 8px;">Resetare parola</h1>
            <p style="font-size: 15px; color: #555; line-height: 1.6; margin: 0 0 28px;">
              Buna, ${user.name || 'utilizator'}!<br/>
              Am primit o cerere de resetare a parolei. Apasa butonul de mai jos pentru a seta o parola noua.
            </p>
            <a href="${resetLink}" style="display: inline-block; padding: 13px 28px; background: #0a0a0a; color: #b7ff00; text-decoration: none; border-radius: 12px; font-size: 15px; font-weight: 700;">
              Reseteaza parola
            </a>
            <p style="font-size: 13px; color: #999; margin-top: 28px; line-height: 1.6;">
              Link-ul este valabil timp de <strong>1 ora</strong>.<br/>
              Daca nu tu ai solicitat resetarea, poti ignora acest email.
            </p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('[forgot-password] Email send error:', emailErr);
    }
    await logActivity({ action: 'auth.password_reset_request', status: 'success', userId: user.id, email: user.email });
  }

  return NextResponse.json({ success: true });
}
