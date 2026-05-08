import { NextResponse } from 'next/server';
import { requestQueue } from '@/app/lib/rateLimiter';
import { getCacheStats } from '@/app/lib/nutritionCache';
import { verifyToken } from '@/app/lib/verifyToken';
import { enforceRateLimit } from '@/app/lib/apiRateLimit';

/**
 * API endpoint pentru monitorizarea stării sistemului
 * Util pentru dashboard admin și alerting
 */
export async function GET(request) {
  const auth = verifyToken(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await enforceRateLimit(request, {
    userId: auth.userId,
    endpoint: 'system-status',
    maxRequests: 30,
    windowMinutes: 1,
  });
  if (rateLimit) return rateLimit;

  const queueStats = requestQueue.getStats();
  const cacheStats = getCacheStats();
  
  const status = {
    timestamp: new Date().toISOString(),
    system: {
      status: queueStats.processing < queueStats.maxConcurrent ? 'healthy' : 'busy',
      uptime: process.uptime(),
    },
    queue: {
      active: queueStats.processing,
      waiting: queueStats.queued,
      maxConcurrent: queueStats.maxConcurrent,
      maxQueueSize: queueStats.maxQueueSize,
      utilizationPercent: Math.round((queueStats.processing / queueStats.maxConcurrent) * 100),
    },
    cache: {
      entries: cacheStats.size,
      maxEntries: cacheStats.maxSize,
      utilizationPercent: Math.round((cacheStats.size / cacheStats.maxSize) * 100),
    },
  };
  
  // Setează status HTTP bazat pe starea sistemului
  const httpStatus = queueStats.queued > queueStats.maxQueueSize * 0.8 ? 503 : 200;
  
  return NextResponse.json(status, { status: httpStatus });
}
