'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';

export function ProtectedRoute({ children, requiredRole = 'trainer' }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/auth');
      } else if (user.role === 'user' && !allowedRoles.includes('user')) {
        // Self-registered users: send to onboarding or client dashboard
        router.push(user.onboarding_completed === false ? '/onboarding' : '/client/dashboard');
      } else if (!allowedRoles.includes(user.role)) {
        // Redirect to correct dashboard based on role
        if (user.role === 'client') {
          router.push('/client/dashboard');
        } else {
          router.push('/dashboard');
        }
      }
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '16px', marginBottom: '12px' }}>Loading...</p>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid rgba(255, 149, 0, 0.2)',
            borderTop: '3px solid var(--primary-orange)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto'
          }} />
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (!user || !allowedRoles.includes(user.role)) {
    return null;
  }
  return children;
}
