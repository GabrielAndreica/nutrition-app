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
};

export default nextConfig;
