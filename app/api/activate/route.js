import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// POST /api/activate — activează contul clientului
export async function POST(request) {
  const { ip, userAgent } = getRequestMeta(request);

  // ─── Rate Limiting pentru Activation (previne brute force pe tokens) ───
  try {
    const { data: rateLimitResult, error: rateLimitError } = await supabase
      .rpc('check_rate_limit', {
        p_user_id: ip || 'unknown',  // Use IP pentru rate limiting înainte de autentificare
        p_endpoint: 'auth-activate',
        p_max_requests: 10,  // Max 10 încercări de activare per oră per IP
        p_window_minutes: 60
      });

    if (rateLimitError) {
      console.error('Rate limit check error:', rateLimitError);
    } else if (rateLimitResult && rateLimitResult.length > 0) {
      const { allowed, remaining, reset_at } = rateLimitResult[0];
      
      if (!allowed) {
        const resetDate = new Date(reset_at);
        const minutesRemaining = Math.ceil((resetDate - new Date()) / 60000);
        return NextResponse.json(
          { error: `Prea multe încercări de activare. Încearcă din nou în ${minutesRemaining} minute.` },
          { status: 429, headers: { 'Retry-After': String(minutesRemaining * 60) } }
        );
      }
    }
  } catch (err) {
    console.error('Rate limit exception:', err);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  let { token, password, name } = body;

  // Validare
  if (!token || !password || !name) {
    return NextResponse.json({ 
      error: 'Token, parolă și nume sunt obligatorii.' 
    }, { status: 400 });
  }

  // Sanitizare nume (previne XSS)
  try {
    name = sanitizeName(name);
  } catch (err) {
    return NextResponse.json({ 
      error: 'Nume invalid: ' + err.message 
    }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ 
      error: 'Parola trebuie să aibă cel puțin 8 caractere.' 
    }, { status: 400 });
  }

  if (name.length < 2) {
    return NextResponse.json({ 
      error: 'Numele trebuie să aibă cel puțin 2 caractere.' 
    }, { status: 400 });
  }

  // Sanitizare token (previne injection)
  token = sanitizeText(token).slice(0, 200);

  // Găsește invitația
  const { data: invitation, error: inviteError } = await supabase
    .from('client_invitations')
    .select('*')
    .eq('token', token)
    .eq('status', 'pending')
    .single();

  if (inviteError || !invitation) {
    logActivity({
      action: 'client.activate',
      status: 'failure',
      ipAddress: ip,
      userAgent,
      details: { token, reason: 'invitation_not_found' },
    });
    return NextResponse.json({ error: 'Invitație invalidă.' }, { status: 404 });
  }

  // Verifică expirarea
  const expiresAt = new Date(invitation.expires_at);
  if (expiresAt < new Date()) {
    // Creează notificare pentru trainer - link expirat (tentativă de activare)
    const { data: clientData } = await supabase
      .from('clients')
      .select('name, trainer_id')
      .eq('id', invitation.client_id)
      .single();

    if (clientData && clientData.trainer_id) {
      // Verifică dacă nu există deja notificare pentru acest link expirat
      const { data: existingNotif } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', clientData.trainer_id)
        .eq('type', 'invitation_expired')
        .eq('related_client_id', invitation.client_id)
        .single();

      if (!existingNotif) {
        const { error: notificationError } = await supabase
          .from('notifications')
          .insert({
            user_id: clientData.trainer_id,
            type: 'invitation_expired',
            title: 'Link de invitație expirat',
            message: `${clientData.name} a încercat să activeze contul dar link-ul a expirat`,
            related_client_id: invitation.client_id,
            is_read: false
          });

        if (notificationError) {
          console.error('Eroare la crearea notificării de expirare:', notificationError);
        } else {
        }
      }
    }

    logActivity({
      action: 'client.activate',
      status: 'failure',
      email: invitation.client_email,
      ipAddress: ip,
      userAgent,
      details: { token, reason: 'invitation_expired' },
    });
    return NextResponse.json({ error: 'Invitația a expirat.' }, { status: 410 });
  }

  // Hash parola
  const hashedPassword = await bcrypt.hash(password, 10);

  // Creează user
  const { data: newUser, error: userError } = await supabase
    .from('users')
    .insert([{
      name: name,
      email: invitation.client_email,
      password: hashedPassword,
      role: 'client', // rol special pentru clienți
    }])
    .select('id, name, email')
    .single();

  if (userError) {
    console.error('Eroare la crearea userului:', userError);
    logActivity({
      action: 'client.activate',
      status: 'failure',
      email: invitation.client_email,
      ipAddress: ip,
      userAgent,
      details: { token, error: userError.message },
    });
    return NextResponse.json({ error: 'Eroare la activarea contului.' }, { status: 500 });
  }

  // Actualizează invitația
  const { error: updateInviteError } = await supabase
    .from('client_invitations')
    .update({
      status: 'accepted',
      user_id: newUser.id,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', invitation.id);

  if (updateInviteError) {
    console.error('Eroare la actualizarea invitației:', updateInviteError);
  }

  // Actualizează clientul cu user_id
  const { error: updateClientError } = await supabase
    .from('clients')
    .update({ user_id: newUser.id })
    .eq('id', invitation.client_id);

  if (updateClientError) {
    console.error('Eroare la actualizarea clientului:', updateClientError);
  }

  // Creează notificare pentru trainer - client activat cu succes
  const { data: clientData } = await supabase
    .from('clients')
    .select('name, trainer_id')
    .eq('id', invitation.client_id)
    .single();

  if (clientData && clientData.trainer_id) {
    const { error: notificationError } = await supabase
      .from('notifications')
      .insert({
        user_id: clientData.trainer_id,
        type: 'client_activated',
        title: 'Client nou activat',
        message: `${clientData.name} și-a activat contul cu succes`,
        related_client_id: invitation.client_id,
        is_read: false
      });

    if (notificationError) {
      console.error('Eroare la crearea notificării de activare:', notificationError);
    } else {
    }
  }

  // Generează JWT token
  const jwtToken = jwt.sign(
    { 
      id: newUser.id, 
      email: newUser.email,
      name: newUser.name,
      role: 'client'
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  logActivity({
    action: 'client.activate',
    status: 'success',
    userId: newUser.id,
    email: newUser.email,
    ipAddress: ip,
    userAgent,
    details: { clientId: invitation.client_id },
  });

  return NextResponse.json({
    success: true,
    token: jwtToken,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      role: 'client'
    }
  });
}
