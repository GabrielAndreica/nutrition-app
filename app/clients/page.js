'use client';

import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import AppHeader from '@/app/components/AppHeader';
import ClientsList from '@/app/components/ClientsList';
import styles from './clients.module.css';

function ClientsContent() {
  return (
    <div className={styles.container}>
      <AppHeader title="Clienti" backHref="/dashboard" />
      <ClientsList />
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
