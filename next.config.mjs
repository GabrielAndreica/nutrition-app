/** @type {import('next').NextConfig} */
const nextConfig = {
  // ============================================
  // PRODUCTION OPTIMIZATIONS
  // ============================================

  // Prevent jsPDF / fflate from being bundled in the SSR (server) environment.
  // These are browser-only libs; they must never run on Node.js during SSR.
  serverExternalPackages: ['jspdf', 'jspdf-autotable', 'fflate'],

  // Compiler optimizations
  compiler: {
    // Remove console.log in production
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'], // Keep error/warn logs
    } : false,
  },

  // Performance optimizations
  experimental: {
    optimizePackageImports: ['@supabase/supabase-js', 'react-icons'],
  },

  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    minimumCacheTTL: 60 * 60 * 24 * 7, // 7 days
  },

  // Compression
  compress: true,

  // Production optimizations
  productionBrowserSourceMaps: false, // Disable source maps in production
  poweredByHeader: false, // Remove X-Powered-By header
  
  // React optimizations
  reactStrictMode: true,

  // Output
  output: 'standalone', // For Docker/serverless optimization

  async redirects() {
    return [
      {
        source: '/landing',
        destination: '/',
        permanent: true,
      },
    ];
  },

  async headers() {
    const securityHeaders = [
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    ];
    const privateApiHeaders = [
      {
        key: 'Cache-Control',
        value: 'no-store, max-age=0',
      },
      {
        key: 'Pragma',
        value: 'no-cache',
      },
      {
        key: 'Vary',
        value: 'Authorization',
      },
    ];

    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        source: '/api/auth/:path*',
        headers: privateApiHeaders,
      },
      {
        source: '/api/stripe/:path*',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/onboarding',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/workout-session',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/training-split',
        headers: privateApiHeaders,
      },
      {
        source: '/api/workout-plans/:path*',
        headers: privateApiHeaders,
      },
      {
        source: '/api/generate-workout-plan',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/plans',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/daily-progress',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/recipes/:path*',
        headers: privateApiHeaders,
      },
      {
        source: '/api/meal-plans/:path*',
        headers: privateApiHeaders,
      },
      {
        source: '/api/generate-meal-plan',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/weekly-checkin',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/xp',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/level',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/cooldowns',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/wallet',
        headers: privateApiHeaders,
      },
      {
        source: '/api/user/friends',
        headers: privateApiHeaders,
      },
      {
        source: '/api/notifications',
        headers: privateApiHeaders,
      },
      {
        source: '/favicon.svg',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/favicon-patrat-verde.svg',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/favicon-patrat-negru.svg',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/logo-verde-transparent.svg',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/logo-negru-transparent.svg',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/screenshots/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
