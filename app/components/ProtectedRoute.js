'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';

function AuthGateSkeleton() {
  const shimmer = {
    background: 'linear-gradient(90deg, #f0f0f5 25%, #fafafa 50%, #f0f0f5 75%)',
    backgroundSize: '800px 100%',
    animation: 'skeletonShimmer 1.5s ease infinite',
  };

  const greenShimmer = {
    background: 'linear-gradient(90deg, rgba(183,255,0,0.22) 25%, rgba(183,255,0,0.12) 50%, rgba(183,255,0,0.22) 75%)',
    backgroundSize: '800px 100%',
    animation: 'skeletonShimmer 1.5s ease infinite',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse 80% 40% at 50% -5%, rgba(183, 255, 0, 0.09) 0%, transparent 65%), #fff',
      fontFamily: 'var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: 18, border: '1px solid rgba(10,10,10,0.08)', borderRadius: 14, background: 'rgba(255,255,255,0.78)' }}>
          <div>
            <div style={{ ...shimmer, width: 180, height: 26, borderRadius: 8 }} />
            <div style={{ ...shimmer, width: 130, height: 13, borderRadius: 999, marginTop: 9 }} />
          </div>
          <div style={{ ...greenShimmer, width: 74, height: 34, borderRadius: 999 }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '28px 20px', border: '1px solid rgba(10,10,10,0.08)', borderRadius: 14, background: 'rgba(255,255,255,0.78)' }}>
          <div style={{ width: 118, height: 118, borderRadius: '50%', background: 'radial-gradient(circle at center, #fff 0 45%, transparent 46%), conic-gradient(rgba(183,255,0,0.22), rgba(10,10,10,0.08))' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ ...shimmer, width: 170, height: 17, borderRadius: 8 }} />
            <div style={{ ...shimmer, width: 118, height: 12, borderRadius: 999 }} />
          </div>
        </div>

        {[1, 2, 3].map(i => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', border: '1px solid rgba(10,10,10,0.08)', borderRadius: 14, background: 'rgba(255,255,255,0.78)' }}>
            <div style={{ ...greenShimmer, width: 22, height: 22, borderRadius: '50%', flexShrink: 0 }} />
            <div style={{ ...shimmer, width: '72%', height: 14, borderRadius: 999 }} />
          </div>
        ))}
      </div>
      <style>{`
        @keyframes skeletonShimmer {
          0% { background-position: -800px 0; }
          100% { background-position: 800px 0; }
        }
      `}</style>
    </div>
  );
}

export function ProtectedRoute({ children, requiredRole = ['user', 'client'] }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  const allowedRoles = useMemo(
    () => (Array.isArray(requiredRole) ? requiredRole : [requiredRole]),
    [requiredRole]
  );

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/auth');
      } else if ((user.role === 'user' || user.role === 'client') && !allowedRoles.includes(user.role)) {
        router.push(user.onboarding_completed === false ? '/onboarding' : '/client/dashboard');
      } else if (!allowedRoles.includes(user.role)) {
        router.push('/client/dashboard');
      }
    }
  }, [user, loading, router, allowedRoles]);

  if (loading) {
    return <AuthGateSkeleton />;
  }

  if (!user || !allowedRoles.includes(user.role)) {
    return null;
  }
  return children;
}
