'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FEATURES, getDefaultRedirectURL } from '@/app/config/features';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import AppHeader from '@/app/components/AppHeader';
import ClientsList from '@/app/components/ClientsList';
import styles from './clients.module.css';

function ClientsContent() {
  const router = useRouter();

  // Dacă legacy routes nu sunt permise, redirecționează imediat
  if (!FEATURES.ALLOW_LEGACY_ROUTES) {
    useEffect(() => {
      router.replace(getDefaultRedirectURL());
    }, [router]);
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', color: '#666' }}>Redirecționare...</div>
        </div>
      </div>
    );
  }

  const handleViewPlan = (planIdOrClientId, isGenerating = false) => {
    if (isGenerating) {
      // Navigare către dashboard unde rulează InlinePlanGenerator cu progresul
      sessionStorage.setItem('viewGeneratingClientId', planIdOrClientId);
      router.push('/dashboard');
    } else {
      // Navigare către pagina de vizualizare plan
      router.push(`/meal-plan/${planIdOrClientId}`);
    }
  };

  const handleGeneratePlan = (clientId) => {
    router.push(`/generator-plan?clientId=${clientId}`);
  };

  return (
    <div className={styles.container}>
      <AppHeader title="Clienti" backHref="/dashboard" />
      <ClientsList 
        onViewPlan={handleViewPlan}
        onGeneratePlan={handleGeneratePlan}
      />
    </div>
  );
}

export default function ClientsPage() {
  return (
    <ProtectedRoute requiredRole="trainer">
      <ClientsContent />
    </ProtectedRoute>
  );
}
