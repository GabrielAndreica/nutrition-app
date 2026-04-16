import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Health check endpoint pentru monitoring
 * Public - nu necesită autentificare
 */
export async function GET() {
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
      error: err.message,
      timestamp: new Date().toISOString()
    }, {
      status: 503
    });
  }
}
