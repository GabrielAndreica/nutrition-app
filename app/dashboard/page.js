'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/app/contexts/AuthContext';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import styles from './dashboard.module.css';
import ClientsList from '@/app/components/ClientsList';

// Dynamic imports cu ssr: false pentru componente care folosesc jsPDF
const InlineMealPlanView = dynamic(() => import('@/app/components/InlineMealPlanView'), { 
  ssr: false,
  loading: () => (
    <div className={styles.loadingOverlay}>
      <div className={styles.loadingSpinner} />
    </div>
  )
});

const InlineProgressView = dynamic(() => import('@/app/components/InlineProgressView'), { 
  ssr: false,
  loading: () => (
    <div className={styles.loadingOverlay}>
      <div className={styles.loadingSpinner} />
    </div>
  )
});

const InlinePlanGenerator = dynamic(() => import('@/app/components/InlinePlanGenerator'), { 
  ssr: false,
  loading: () => (
    <div className={styles.loadingOverlay}>
      <div className={styles.loadingSpinner} />
    </div>
  )
});

function DashboardContent() {
  const router = useRouter();
  const { logout, user } = useAuth();
  const mainRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewingPlanId, setViewingPlanId] = useState(null);
  const [viewingProgressClientId, setViewingProgressClientId] = useState(null);
  const [generatingPlanClientId, setGeneratingPlanClientId] = useState(null);

  useEffect(() => {
    // Prefetch critical routes pentru navigare rapidă
    router.prefetch('/clients');
    router.prefetch('/generator-plan');
    
    // Prefetch date pentru clienți în fundal
    const token = localStorage.getItem('token');
    if (token) {
      fetch('/api/clients?page=1&limit=10', {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }, [router]);

  const firstName = user?.name?.split(' ')[0] || user?.name || '';
  const handleLogout = () => { logout(); router.push('/'); };
  const handleNav = (path) => { setSidebarOpen(false); router.push(path); };

  return (
    <div className={styles.container}>
      {/* Mobile top bar */}
      <div className={styles.mobileTopbar}>
        <button className={styles.hamburger} onClick={() => setSidebarOpen(v => !v)} aria-label="Meniu">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <div className={styles.mobileLogo}>
          <div className={styles.sidebarLogoMark}>N</div>
          <span className={styles.sidebarLogoText}>NutriApp</span>
        </div>
      </div>

      {sidebarOpen && <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />}

      <div className={styles.pageLayout}>
        {/* Sidebar */}
        <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
          <div className={styles.sidebarLogo}>
            <div className={styles.sidebarLogoMark}>N</div>
            <span className={styles.sidebarLogoText}>NutriApp</span>
            <button className={styles.sidebarCloseBtn} onClick={() => setSidebarOpen(false)} aria-label="Închide meniu">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className={styles.sidebarSection}>Meniu</div>

          <div className={styles.sidebarItem} onClick={() => handleNav('/clients')}>
            <div className={styles.sidebarIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <span className={styles.sidebarLabel}>Clienți</span>
          </div>

          <div className={styles.sidebarItem} onClick={() => handleNav('/generator-plan')}>
            <div className={styles.sidebarIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className={styles.sidebarLabel}>Generator Plan</span>
          </div>

          <div className={styles.sidebarFooter}>
            <button className={styles.sidebarLogoutBtn} onClick={handleLogout}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Ieșire
            </button>
          </div>
        </aside>

        {/* Main */}
        <main ref={mainRef} className={styles.main}>
          {!viewingPlanId && !viewingProgressClientId && !generatingPlanClientId && (
            <>
              <div className={styles.hero}>
                <h2 className={styles.heroHeading}>
                  Bună ziua, <span className={styles.accent}>{firstName}</span>.
                </h2>
                <p className={styles.heroSub}>
                  Gestionează clienții și generează planuri alimentare personalizate.
                </p>
              </div>
              <ClientsList
                noPadding
                onViewPlan={(planId) => setViewingPlanId(planId)}
                onViewProgress={(clientId) => setViewingProgressClientId(clientId)}
              />
            </>
          )}
          {viewingPlanId && !viewingProgressClientId && !generatingPlanClientId && (
            <InlineMealPlanView
              planId={viewingPlanId}
              scrollContainerRef={mainRef}
              onBack={() => setViewingPlanId(null)}
              onViewProgress={(clientId) => {
                setViewingPlanId(null);
                setViewingProgressClientId(clientId);
              }}
            />
          )}
          {viewingProgressClientId && (
            <InlineProgressView
              clientId={viewingProgressClientId}
              scrollContainerRef={mainRef}
              onBack={(planId) => {
                setViewingProgressClientId(null);
                if (planId) {
                  setViewingPlanId(planId);
                }
              }}
              onGeneratePlan={(clientId) => {
                setViewingProgressClientId(null);
                setGeneratingPlanClientId(clientId);
              }}
            />
          )}
          {generatingPlanClientId && !viewingProgressClientId && (
            <InlinePlanGenerator
              clientId={generatingPlanClientId}
              scrollContainerRef={mainRef}
              onBack={() => {
                setGeneratingPlanClientId(null);
              }}
              onPlanGenerated={(planId) => {
                setGeneratingPlanClientId(null);
                setViewingProgressClientId(null);
                setViewingPlanId(planId);
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute requiredRole="trainer">
      <DashboardContent />
    </ProtectedRoute>
  );
}
