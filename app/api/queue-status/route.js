import { NextResponse } from 'next/server';
import { requestQueue } from '@/app/lib/rateLimiter';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

/**
 * GET /api/queue-status
 * Returnează statisticile curente ale queue-ului
 */
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'queue-status',
    maxRequests: 120,
    windowMinutes: 1,
  });
  if (rateLimit) return rateLimit;

  try {
    const stats = requestQueue.getStats();
    
    return NextResponse.json({
      processing: stats.processing,
      queued: stats.queued,
      maxConcurrent: stats.maxConcurrent,
      maxQueueSize: stats.maxQueueSize,
      estimatedWaitTime: stats.queued > 0 ? Math.ceil(stats.queued * 30) : 0, // ~30s per plan
    });
  } catch (error) {
    console.error('Error getting queue status:', error);
    return NextResponse.json(
      { error: 'Eroare la verificarea statusului' },
      { status: 500 }
    );
  }
}
