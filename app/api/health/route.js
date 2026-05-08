import { NextResponse } from 'next/server';
import { getSupabase } from '@/app/lib/supabase';

/**
 * Health check endpoint pentru monitoring
 * Public - nu necesită autentificare
 */
export async function GET(request) {
  const detailsEnabled =
    process.env.HEALTH_CHECK_TOKEN &&
    request.headers.get('authorization') === `Bearer ${process.env.HEALTH_CHECK_TOKEN}`;

  if (!detailsEnabled) {
    return NextResponse.json(
      { status: 'ok', timestamp: new Date().toISOString() },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
      }
    );
  }

  const supabase = getSupabase();
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {}
  };

  try {
    // Check database connection
    const dbStart = Date.now();
    const { error: dbError } = await supabase
      .from('users')
      .select('id')
      .limit(1);
    
    checks.services.database = {
      status: dbError ? 'unhealthy' : 'healthy',
      responseTime: Date.now() - dbStart
    };

    // Check OpenAI (optional - poate fi expensive)
    checks.services.openai = {
      status: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured'
    };

    // Overall status
    const allHealthy = Object.values(checks.services).every(
      s => s.status === 'healthy' || s.status === 'configured'
    );
    
    checks.status = allHealthy ? 'healthy' : 'degraded';

    return NextResponse.json(checks, {
      status: allHealthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      }
    });

  } catch (err) {
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString()
    }, {
      status: 503
    });
  }
}
