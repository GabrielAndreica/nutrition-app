'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';

export function ProtectedRoute({ children, requiredRole = 'trainer' }) {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/auth');
      } else if (user.role !== requiredRole) {
        // Redirect to correct dashboard based on role
        if (user.role === 'client') {
          router.push('/client/dashboard');
        } else {
          router.push('/dashboard');
        }
      }
    }
  }, [user, loading, router, requiredRole]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-secondary)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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

  if (!user) {
    return null;
  }
  // Check if user has the required role
  if (user.role !== requiredRole) {
    return null;
  }
  return children;
}
