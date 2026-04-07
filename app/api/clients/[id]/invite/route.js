import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@/app/lib/verifyToken';
import { logActivity, getRequestMeta } from '@/app/lib/logger';
import crypto from 'crypto';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// POST /api/clients/[id]/invite — trimite invitație client
export async function POST(request, { params }) {
  const { id } = await params;
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'trainer') return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalid.' }, { status: 400 });
  }

  const { email } = body;

  if (!email || !email.trim()) {
    return NextResponse.json({ error: 'Email-ul clientului este obligatoriu.' }, { status: 400 });
  }

  // Validare email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: 'Format de email invalid.' }, { status: 400 });
  }

  const { ip, userAgent } = getRequestMeta(request);

  // Verifică dacă clientul aparține antrenorului
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, name, user_id')
    .eq('id', id)
    .eq('trainer_id', auth.userId)
    .single();

  if (clientError || !client) {
    return NextResponse.json({ error: 'Clientul nu a fost găsit sau nu ai acces.' }, { status: 404 });
  }

  // Verifică dacă clientul are deja cont activ
  if (client.user_id) {
    return NextResponse.json({ 
      error: 'Clientul are deja un cont activ.' 
    }, { status: 400 });
  }

  // Verifică dacă există invitații pending și invalidează-le (permite retrimierea în caz de email greșit)
  const { data: existingInvitations } = await supabase
    .from('client_invitations')
    .select('id, status, client_email')
    .eq('client_id', id)
    .eq('status', 'pending');

  if (existingInvitations && existingInvitations.length > 0) {
    // Invalidează invitațiile pending existente
    await supabase
      .from('client_invitations')
      .update({ status: 'expired' })
      .eq('client_id', id)
      .eq('status', 'pending');

    logActivity({
      action: 'client.invite',
      status: 'info',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { 
        clientId: id, 
        action: 'invalidated_previous_invitations',
        count: existingInvitations.length,
        previousEmails: existingInvitations.map(inv => inv.client_email)
      },
    });
  }

  // Verifică dacă emailul este deja folosit de alt utilizator
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .single();

  if (existingUser) {
    return NextResponse.json({ 
      error: 'Acest email este deja înregistrat în sistem.' 
    }, { status: 400 });
  }

  // Generează token unic
  const token = crypto.randomBytes(32).toString('hex');

  // Creează invitația
  const { data: invitation, error: inviteError } = await supabase
    .from('client_invitations')
    .insert([{
      client_id: id,
      trainer_id: auth.userId,
      client_email: email.toLowerCase(),
      token,
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 zile
    }])
    .select()
    .single();

  if (inviteError) {
    console.error('Eroare la crearea invitației:', inviteError);
    logActivity({
      action: 'client.invite',
      status: 'failure',
      userId: auth.userId,
      email: auth.email,
      ipAddress: ip,
      userAgent,
      details: { clientId: id, clientEmail: email, error: inviteError.message },
    });
    return NextResponse.json({ error: 'Eroare la crearea invitației.' }, { status: 500 });
  }

  // Trimite email (TODO: integrare cu serviciu de email)
  const activationLink = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/activate/${token}`;

  let emailSent = false;
  let emailError = null;

  try {
    const { data: emailData, error: sendError } = await resend.emails.send({
      from: 'mail@gabrielandreica.com',
      to: email.toLowerCase(),
      subject: 'Activează-ți contul NutriApp',
      html: `
        <h2>Bine ai venit!</h2>
        <p>Antrenorul tău te-a invitat să creezi un cont pe NutriApp.</p>
        <p><a href="${activationLink}" style="background:#b7ff00;color:#000;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700;">Activează contul</a></p>
        <p style="color:#666;font-size:13px;">Linkul expiră în 7 zile.</p>
      `,
    });
    if (sendError) {
      console.error('[Resend] Eroare la trimitere:', JSON.stringify(sendError));
      emailError = sendError.message || JSON.stringify(sendError);
    } else {
      emailSent = true;
      console.log('[Resend] Email trimis cu succes, ID:', emailData?.id);
    }
  } catch (emailErr) {
    console.error('[Resend] Excepție:', emailErr?.message || emailErr);
    emailError = emailErr?.message || 'Eroare necunoscută';
  }

  logActivity({
    action: 'client.invite',
    status: 'success',
    userId: auth.userId,
    email: auth.email,
    ipAddress: ip,
    userAgent,
    details: { 
      clientId: id, 
      clientName: client.name,
      clientEmail: email,
      invitationId: invitation.id 
    },
  });

  return NextResponse.json({ 
    success: true,
    emailSent,
    emailError,
    invitation: {
      id: invitation.id,
      email: email,
      expiresAt: invitation.expires_at,
      activationLink
    }
  });
}
