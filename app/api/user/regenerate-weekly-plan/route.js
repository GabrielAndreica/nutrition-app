import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';
import { verifyToken } from '@/app/lib/verifyToken';
import { runWeeklyPlanRegenerationForClient } from '@/app/lib/weeklyPlanRegeneration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request) {
  const auth = verifyToken(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== 'user' && auth.role !== 'client') {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 403 });
  }

  const encoder = new TextEncoder();
  const responseStream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (!closed) {
          closed = true;
          try { controller.close(); } catch {}
        }
      };

      try {
        send({ type: 'progress', phase: 'setup', progress: 4, message: 'Pregătim planurile noi...' });
        const result = await runWeeklyPlanRegenerationForClient({
          clientId: auth.userId,
          request,
          onEvent: (event) => send(event),
        });

        if (result?.skipped) {
          send({
            type: 'complete',
            skipped: true,
            reason: result.reason,
            message: 'Nu există o regenerare scadentă acum.',
          });
        } else {
          send({
            type: 'complete',
            planId: result?.mealPlanId || null,
            workoutPlanId: result?.workoutPlanId || null,
            message: 'Planurile noi sunt gata.',
          });
        }
      } catch (err) {
        send({ type: 'error', message: String(err?.message || 'Regenerarea planurilor a eșuat.') });
      } finally {
        close();
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  });
}
