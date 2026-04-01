import { NextResponse } from 'next/server';
import { requestQueue } from '@/app/lib/rateLimiter';
import { getCacheStats } from '@/app/lib/nutritionCache';

/**
 * API endpoint pentru monitorizarea stării sistemului
 * Util pentru dashboard admin și alerting
 */
export async function GET() {
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
