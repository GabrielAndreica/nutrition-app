import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logActivity, getRequestMeta } from '@/app/lib/logger';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// GET /api/activate/[token] — verifică token și returnează detalii invitație
export async function GET(request, { params }) {
  const { token } = await params;
  const { ip, userAgent } = getRequestMeta(request);

  if (!token) {
    return NextResponse.json({ error: 'Token lipsă.' }, { status: 400 });
  }

  // Caută invitația
  const { data: invitation, error } = await supabase
    .from('client_invitations')
    .select(`
      id,
      client_email,
      expires_at,
      status,
      client_id,
      clients (
        name
      )
    `)
    .eq('token', token)
    .single();

  if (error || !invitation) {
    logActivity({
      action: 'client.activation_check',
      status: 'failure',
      ipAddress: ip,
      userAgent,
      details: { token, reason: 'invitation_not_found' },
    });
    return NextResponse.json({ error: 'Invitație invalidă.' }, { status: 404 });
  }

  // Verifică dacă a expirat
  const expiresAt = new Date(invitation.expires_at);
  if (expiresAt < new Date()) {
    logActivity({
      action: 'client.activation_check',
      status: 'failure',
      email: invitation.client_email,
      ipAddress: ip,
      userAgent,
      details: { token, reason: 'invitation_expired' },
    });
    return NextResponse.json({ error: 'Invitația a expirat.' }, { status: 410 });
  }

  // Verifică dacă a fost deja acceptată
  if (invitation.status === 'accepted') {
    return NextResponse.json({ error: 'Invitația a fost deja folosită.' }, { status: 410 });
  }

  logActivity({
    action: 'client.activation_check',
    status: 'success',
    email: invitation.client_email,
    ipAddress: ip,
    userAgent,
    details: { token, clientId: invitation.client_id },
  });

  return NextResponse.json({
    valid: true,
    email: invitation.client_email,
    clientName: invitation.clients?.name,
  });
}
