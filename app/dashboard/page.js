'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/app/contexts/AuthContext';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import { createClient } from '@supabase/supabase-js';
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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [visibleNotifications, setVisibleNotifications] = useState(5);
  const [allNotifications, setAllNotifications] = useState([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const notificationsListRef = useRef(null);
  const notificationsPanelRef = useRef(null);
  const [viewingPlanId, setViewingPlanId] = useState(null);
  const [viewingProgressClientId, setViewingProgressClientId] = useState(null);
  const [generatingPlanClientId, setGeneratingPlanClientId] = useState(null);
  const [addingClient, setAddingClient] = useState(false);

  useEffect(() => {
    // ─── Optimizare: Prefetch routes + preload data cu cache ───────
    router.prefetch('/clients');
    router.prefetch('/generator-plan');
    
    // Prefetch clienți în fundal cu timeout
    const token = localStorage.getItem('token');
    if (token) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      fetch('/api/clients?page=1&limit=10', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
        .then(() => clearTimeout(timeoutId))
        .catch(() => clearTimeout(timeoutId));
      
      return () => {
        clearTimeout(timeoutId);
        controller.abort();
      };
    }
  }, [router]);

  const firstName = user?.name?.split(' ')[0] || user?.name || '';
  const handleLogout = () => { logout(); router.push('/'); };
  const handleNav = (path) => { setSidebarOpen(false); router.push(path); };

  const fetchNotificationsRef = useRef(null);

  // Fetch notifications from API
  const fetchNotifications = async ({ limit = 5 } = {}) => {
    setLoadingNotifications(true);
    try {
      const token = localStorage.getItem('token');
      
      // ─── Optimizare: Timeout 5s pentru notificări ───────
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`/api/notifications?limit=${limit}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        // Transform notifications to match UI format
        const formattedNotifications = data.notifications.map(notif => {
          let type = 'system';
          if (notif.type === 'progress_update') type = 'progress';
          if (notif.type === 'client_activated') type = 'client';
          if (notif.type === 'invitation_expired') type = 'warning';
          if (notif.type === 'plan_generated') type = 'plan';
          
          return {
            id: notif.id,
            type,
            title: notif.title || null,
            message: notif.message,
            time: formatNotificationTime(notif.created_at),
            unread: !notif.is_read,
            clientId: notif.related_client_id,
            planId: notif.related_plan_id,
            clientName: notif.clients?.name || null
          };
        });
        setAllNotifications(formattedNotifications);
      } else {
        const errorData = await response.json();
        console.error('Failed to fetch notifications:', response.status, errorData);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.warn('Notifications fetch timeout');
      } else {
        console.error('Error fetching notifications:', error);
      }
    } finally {
      setLoadingNotifications(false);
    }
  };
  fetchNotificationsRef.current = fetchNotifications;

  // Format notification time (relative)
  const formatNotificationTime = (createdAt) => {
    const now = new Date();
    const created = new Date(createdAt);
    const diffMs = now - created;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    const diffWeeks = Math.floor(diffMs / 604800000);

    if (diffMins < 1) return 'acum';
    if (diffMins < 60) return `acum ${diffMins} ${diffMins === 1 ? 'minut' : 'minute'}`;
    if (diffHours < 24) return `acum ${diffHours} ${diffHours === 1 ? 'oră' : 'ore'}`;
    if (diffDays === 1) return 'ieri';
    if (diffDays < 7) return `acum ${diffDays} zile`;
    if (diffWeeks === 1) return 'acum 1 săptămână';
    if (diffWeeks < 4) return `acum ${diffWeeks} săptămâni`;
    return created.toLocaleDateString('ro-RO');
  };

  // Mark notifications as read
  const markNotificationsAsRead = async (notificationIds) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ notification_ids: notificationIds })
      });

      if (response.ok) {
        // Update local state
        setAllNotifications(prev => 
          prev.map(notif => 
            notificationIds.includes(notif.id) 
              ? { ...notif, unread: false }
              : notif
          )
        );
      }
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mark_all: true })
      });

      if (response.ok) {
        setAllNotifications(prev => prev.map(notif => ({ ...notif, unread: false })));
      }
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  // Handle notification click
  const handleNotificationClick = (notification) => {
    // Mark as read
    if (notification.unread) {
      markNotificationsAsRead([notification.id]);
    }

    // Navigate to progress view if it's a progress notification
    if (notification.type === 'progress' && notification.clientId) {
      setNotificationsOpen(false);
      
      // Dacă suntem deja pe această pagină, forțăm reîncărcarea prin reset + set
      if (viewingProgressClientId === notification.clientId) {
        setViewingProgressClientId(null);
        setTimeout(() => {
          setViewingProgressClientId(notification.clientId);
        }, 10);
      } else {
        setViewingProgressClientId(notification.clientId);
      }
      
      // Scroll to top
      if (mainRef.current) {
        mainRef.current.scrollTop = 0;
      }
    }

    // Navigate to meal plan if it's a plan_generated notification
    if (notification.type === 'plan' && notification.planId) {
      setNotificationsOpen(false);
      setViewingProgressClientId(null);
      setGeneratingPlanClientId(null);
      setViewingPlanId(notification.planId);
      if (mainRef.current) mainRef.current.scrollTop = 0;
    }
  };

  // Fetch notifications on mount + Supabase Realtime subscription
  useEffect(() => {
    fetchNotifications({ limit: 5 });

    // ─── Supabase Realtime: notificare instantă la INSERT ───────
    const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const token = localStorage.getItem('token');
    let trainerId = null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      trainerId = payload.userId || payload.id || payload.sub;
    } catch {}

    let supabaseClient = null;
    let channel = null;
    if (supabaseUrl && supabaseAnon && trainerId) {
      supabaseClient = createClient(supabaseUrl, supabaseAnon);
      channel = supabaseClient
        .channel('notifications-' + trainerId)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `trainer_id=eq.${trainerId}`,
          },
          () => {
            // Nouă notificare apărută — reîncarcă lista
            fetchNotifications({ limit: 5 });
          }
        )
        .subscribe();
    }

    // Fallback polling la 30s (dacă Realtime nu e disponibil)
    const intervalId = setInterval(() => fetchNotifications({ limit: 5 }), 30000);

    return () => {
      clearInterval(intervalId);
      if (channel && supabaseClient) supabaseClient.removeChannel(channel);
    };
  }, []);

  // Polling mai rapid când panoul de notificări e deschis
  useEffect(() => {
    if (!notificationsOpen) return;
    fetchNotifications({ limit: 5 }); // refresh imediat la deschidere
    const id = setInterval(() => fetchNotifications({ limit: 5 }), 15000);
    return () => clearInterval(id);
  }, [notificationsOpen]);

  // Fetch notificări imediat când o generare tocmai s-a terminat
  useEffect(() => {
    const handler = () => fetchNotificationsRef.current?.({ limit: 5 });
    window.addEventListener('generationFinished', handler);
    return () => window.removeEventListener('generationFinished', handler);
  }, []);

  // Check if returning to view generating plan
  useEffect(() => {
    const viewGeneratingClientId = sessionStorage.getItem('viewGeneratingClientId');
    if (viewGeneratingClientId) {
      sessionStorage.removeItem('viewGeneratingClientId');
      setGeneratingPlanClientId(viewGeneratingClientId);
    }
  }, []);

  // Infinite scroll handler
  useEffect(() => {
    const handleScroll = () => {
      const list = notificationsListRef.current;
      if (!list) return;

      const { scrollTop, scrollHeight, clientHeight } = list;
      // Load more when user is 100px from bottom
      if (scrollHeight - scrollTop - clientHeight < 100) {
        setVisibleNotifications(prev => {
          const newCount = Math.min(prev + 5, allNotifications.length);
          return newCount;
        });
      }
    };

    const list = notificationsListRef.current;
    if (list && notificationsOpen) {
      list.addEventListener('scroll', handleScroll);
      return () => list.removeEventListener('scroll', handleScroll);
    }
  }, [notificationsOpen, allNotifications.length]);

  // Reset visible notifications when closing panel
  useEffect(() => {
    if (!notificationsOpen) {
      setVisibleNotifications(5);
    }
  }, [notificationsOpen]);

  // Click outside to close notifications
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notificationsPanelRef.current && 
          !notificationsPanelRef.current.contains(event.target) &&
          !event.target.closest('[data-notification-trigger]')) {
        setNotificationsOpen(false);
      }
    };

    if (notificationsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [notificationsOpen]);

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
        <button className={styles.mobileNotificationsBtn} onClick={() => setNotificationsOpen(v => !v)} aria-label="Notificări" data-notification-trigger>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {allNotifications.filter(n => n.unread).length > 0 && (
            <span className={styles.mobileNotificationBadge}>{allNotifications.filter(n => n.unread).length}</span>
          )}
        </button>
      </div>

      {sidebarOpen && <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />}
      {notificationsOpen && <div className={styles.notificationsOverlay} onClick={() => setNotificationsOpen(false)} />}

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

          <div className={`${styles.sidebarItem} ${styles.desktopOnly}`} onClick={() => setNotificationsOpen(!notificationsOpen)} data-notification-trigger>
            <div className={styles.sidebarIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <span className={styles.sidebarLabel}>Notificări</span>
            {allNotifications.filter(n => n.unread).length > 0 && (
              <span className={styles.sidebarBadge}>{allNotifications.filter(n => n.unread).length}</span>
            )}
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

        {/* Notifications Panel - lateral sidebar */}
        {notificationsOpen && (
          <div className={styles.notificationsPanel} ref={notificationsPanelRef}>
            <div className={styles.notificationsPanelHeader}>
              <h4 className={styles.notificationsPanelTitle}>Notificări</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {allNotifications.some(n => n.unread) && (
                  <button 
                    className={styles.markAllReadBtn}
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      markAllAsRead();
                    }}
                  >
                    Marchează toate ca citite
                  </button>
                )}
                <button 
                  className={styles.notificationCloseBtn}
                  onClick={() => setNotificationsOpen(false)}
                  aria-label="Închide notificări"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>
            <div className={styles.notificationsList} ref={notificationsListRef}>
              {loadingNotifications && allNotifications.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                  Se încarcă...
                </div>
              ) : allNotifications.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                  Nu ai notificări
                </div>
              ) : (
                allNotifications.slice(0, visibleNotifications).map(notif => (
                  <div 
                    key={notif.id} 
                    className={`${styles.notificationItem} ${notif.unread ? styles.notificationUnread : ''}`}
                    onClick={() => handleNotificationClick(notif)}
                  >
                  <div className={styles.notificationIcon}>
                    {notif.type === 'progress' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                      </svg>
                    ) : notif.type === 'client' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                    ) : notif.type === 'warning' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="16" x2="12" y2="12"/>
                        <line x1="12" y1="8" x2="12.01" y2="8"/>
                      </svg>
                    )}
                  </div>
                  <div className={styles.notificationContent}>
                    {notif.title && <div className={styles.notificationTitle}>{notif.title}</div>}
                    <p className={styles.notificationMessage}>{notif.message}</p>
                    <span className={styles.notificationTime}>{notif.time}</span>
                  </div>
                  {notif.unread && <span className={styles.notificationDot} />}
                </div>
              ))
              )}
            </div>
          </div>
        )}

        {/* Main */}
        <main ref={mainRef} className={styles.main}>
          {!viewingPlanId && !viewingProgressClientId && !generatingPlanClientId && (
            <>
              {!addingClient && (
                <div className={styles.hero}>
                  <h2 className={styles.heroHeading}>
                    Bună ziua, <span className={styles.accent}>{firstName}</span>.
                  </h2>
                  <p className={styles.heroSub}>
                    Gestionează clienții și generează planuri alimentare personalizate.
                  </p>
                </div>
              )}
              <ClientsList
                noPadding
                onViewPlan={(planId) => setViewingPlanId(planId)}
                onViewProgress={(clientId) => setViewingProgressClientId(clientId)}
                onGeneratePlan={(clientId) => setGeneratingPlanClientId(clientId)}
                onAddFormChange={(isOpen) => setAddingClient(isOpen)}
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
