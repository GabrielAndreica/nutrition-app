import { NextResponse } from 'next/server';
import { requestQueue } from '@/app/lib/rateLimiter';

/**
 * GET /api/queue-status
 * Returnează statisticile curente ale queue-ului
 */
export async function GET(request) {
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
