'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import styles from './dashboard.module.css';

function DashboardContent() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleLogout = () => {
    logout();
    router.push('/');
  };


  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1>Welcome, {user?.name}!</h1>
          <button onClick={handleLogout} className={styles.logoutBtn}>
            Logout
          </button>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.card}>
          <div className={styles.cardIcon}>📊</div>
          <h2>Meal Plans</h2>
          <p>Generate personalized nutrition plans</p>
          <button className={styles.primaryBtn}>Generate Plan</button>
        </div>

        <div className={styles.card}>
          <div className={styles.cardIcon}>📈</div>
          <h2>Progress Tracker</h2>
          <p>Monitor your nutrition goals</p>
          <button className={styles.primaryBtn}>View Progress</button>
        </div>

        <div className={styles.card}>
          <div className={styles.cardIcon}>⚙️</div>
          <h2>Settings</h2>
          <p>Manage your preferences</p>
          <button className={styles.primaryBtn}>Go to Settings</button>
        </div>
      </div>

      <div className={styles.userCard}>
        <h3>Account Info</h3>
        <div className={styles.userInfo}>
          <div>
            <label>Email</label>
            <p>{user?.email}</p>
          </div>
          <div>
            <label>Member Since</label>
            <p>March 2026</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
