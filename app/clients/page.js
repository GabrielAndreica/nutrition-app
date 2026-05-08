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
  const legacyRoutesAllowed = FEATURES.ALLOW_LEGACY_ROUTES;

  useEffect(() => {
    // Dacă legacy routes nu sunt permise, redirecționează imediat
    if (!legacyRoutesAllowed) {
      router.replace(getDefaultRedirectURL());
    }
  }, [legacyRoutesAllowed, router]);

  if (!legacyRoutesAllowed) {
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

  const handleGenerateWorkoutPlan = (clientId) => {
    router.push(`/generator-antrenament?clientId=${clientId}`);
  };

  return (
    <div className={styles.container}>
      <AppHeader title="Clienti" backHref="/dashboard" />
      <ClientsList 
        onViewPlan={handleViewPlan}
        onGeneratePlan={handleGeneratePlan}
        onGenerateWorkoutPlan={handleGenerateWorkoutPlan}
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
