import { NextResponse } from 'next/server';
import { runDueWeeklyPlanRegenerations } from '@/app/lib/weeklyPlanRegeneration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(request) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret && process.env.NODE_ENV !== 'production') return true;

  const authHeader = request.headers.get('authorization') || '';
  const cronHeader = request.headers.get('x-cron-secret') || '';
  return authHeader === `Bearer ${configuredSecret}` || cronHeader === configuredSecret;
}

async function handleCron(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Acces interzis.' }, { status: 401 });
  }

  const results = await runDueWeeklyPlanRegenerations({ request, limit: 1 });
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    processed: results.length,
    results,
  });
}

export async function GET(request) {
  return handleCron(request);
}

export async function POST(request) {
  return handleCron(request);
}
