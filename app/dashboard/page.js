'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/app/contexts/AuthContext';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import { createClient } from '@supabase/supabase-js';
import styles from './dashboard.module.css';
import ClientsList from '@/app/components/ClientsList';
import TrialBanner from '@/app/components/TrialBanner';

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

const InlineWorkoutPlanView = dynamic(() => import('@/app/components/InlineWorkoutPlanView'), {
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
  const [viewingWorkoutPlanId, setViewingWorkoutPlanId] = useState(null);
  const [viewingProgressClientId, setViewingProgressClientId] = useState(null);
  const [generatingPlanClientId, setGeneratingPlanClientId] = useState(null);
  const [addingClient, setAddingClient] = useState(false);
  const [deleteClientId, setDeleteClientId] = useState(null);
  const [confirmDeleteClientId, setConfirmDeleteClientId] = useState(null);
  const [deletingFromPlan, setDeletingFromPlan] = useState(false);
  const [returnPlanId, setReturnPlanId] = useState(null);
  const [returnWorkoutPlanId, setReturnWorkoutPlanId] = useState(null);
  const [clientDataVersion, setClientDataVersion] = useState(0);
  const clientsListRef = useRef(null);

  const handleConfirmDeleteFromPlan = async () => {
    if (!confirmDeleteClientId) return;
    setDeletingFromPlan(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/clients/${confirmDeleteClientId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Eroare la stergere');
      clientsListRef.current?.removeClient(confirmDeleteClientId);
      setConfirmDeleteClientId(null);
      setViewingPlanId(null);
      setViewingWorkoutPlanId(null);
    } catch (err) {
      console.error(err);
      setConfirmDeleteClientId(null);
    } finally {
      setDeletingFromPlan(false);
    }
  };

  const handleEditClientFromPlan = async (clientId, sourcePlanId, sourceWorkoutPlanId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/clients/${clientId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const client = data.client || data;
      if (!client?.id || !clientsListRef.current) return;
      if (sourcePlanId) setReturnPlanId(sourcePlanId);
      if (sourceWorkoutPlanId) setReturnWorkoutPlanId(sourceWorkoutPlanId);
      clientsListRef.current.triggerEditClient(client);
      setViewingPlanId(null);
      setViewingWorkoutPlanId(null);
    } catch (e) {
      console.error('handleEditClientFromPlan error', e);
    }
  };

  useEffect(() => {
    // ─── Optimizare: Prefetch routes + preload data cu cache ───────
    router.prefetch('/clients');
    router.prefetch('/generator-plan');
    router.prefetch('/generator-antrenament');
    
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

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', email: '', currentPassword: '', newPassword: '' });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileConfirm, setProfileConfirm] = useState(false);

  const openProfile = () => {
    setProfileForm({ name: user?.name || '', email: user?.email || '', currentPassword: '', newPassword: '' });
    setProfileError('');
    setProfileSuccess('');
    setProfileConfirm(false);
    setProfileOpen(true);
    setSidebarOpen(false);
  };

  const handleProfileSave = async () => {
    setProfileLoading(true);
    setProfileError('');
    setProfileSuccess('');
    setProfileConfirm(false);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: profileForm.name !== user?.name ? profileForm.name : undefined,
          email: profileForm.email !== user?.email ? profileForm.email : undefined,
          currentPassword: profileForm.currentPassword || undefined,
          newPassword: profileForm.newPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setProfileError(data.error || 'Eroare la salvare.'); return; }
      const updated = { ...user, ...data.user };
      localStorage.setItem('user', JSON.stringify(updated));
      login(updated, token);
      setProfileSuccess('Datele au fost salvate cu succes!');
      setProfileForm(f => ({ ...f, currentPassword: '', newPassword: '' }));
    } catch {
      setProfileError('Eroare de rețea. Încearcă din nou.');
    } finally {
      setProfileLoading(false);
    }
  };

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
          if (notif.type === 'new_workout_plan') type = 'workout';
          
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
      setViewingWorkoutPlanId(null);
      setViewingPlanId(notification.planId);
      if (mainRef.current) mainRef.current.scrollTop = 0;
    }

    if (notification.type === 'workout' && notification.planId) {
      setNotificationsOpen(false);
      setViewingPlanId(null);
      setViewingProgressClientId(null);
      setGeneratingPlanClientId(null);
      setViewingWorkoutPlanId(notification.planId);
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
    <>
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
          <span style={{fontSize:'20px',fontWeight:700,color:'#B7FF00',letterSpacing:'-0.5px',fontFamily:"'Space Grotesk', sans-serif"}}>trevano</span>
        </div>
        <button className={styles.mobileNotificationsBtn} onClick={() => setNotificationsOpen(v => !v)} aria-label="Notificări" data-notification-trigger>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {allNotifications.filter(n => n.unread).length > 0 && (
            <span className={styles.mobileDot} />
          )}
        </button>
      </div>

      {sidebarOpen && <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />}

      {/* Profile Modal */}
      {profileOpen && (
        <div className={styles.profileModalOverlay} onClick={() => setProfileOpen(false)}>
          <div className={styles.profileModal} onClick={e => e.stopPropagation()}>
            <div className={styles.profileModalHeader}>
              <h3 className={styles.profileModalTitle}>Profilul meu</h3>
              <button className={styles.profileModalClose} onClick={() => setProfileOpen(false)} aria-label="Închide">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <form onSubmit={e => e.preventDefault()} className={styles.profileModalForm}>
              <div className={styles.profileModalGroup}>
                <label className={styles.profileModalLabel}>Nume</label>
                <input
                  className={styles.profileModalInput}
                  type="text"
                  value={profileForm.name}
                  onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Numele tău"
                />
              </div>
              <div className={styles.profileModalGroup}>
                <label className={styles.profileModalLabel}>Email</label>
                <input
                  className={styles.profileModalInput}
                  type="email"
                  value={profileForm.email}
                  onChange={e => setProfileForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@exemplu.com"
                />
              </div>
              <div className={styles.profileModalDivider} />
              <p className={styles.profileModalSectionLabel}>Schimbă parola (opțional)</p>
              <div className={styles.profileModalGroup}>
                <label className={styles.profileModalLabel}>Parola curentă</label>
                <input
                  className={styles.profileModalInput}
                  type="password"
                  value={profileForm.currentPassword}
                  onChange={e => setProfileForm(f => ({ ...f, currentPassword: e.target.value }))}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
              <div className={styles.profileModalGroup}>
                <label className={styles.profileModalLabel}>Parola nouă</label>
                <input
                  className={styles.profileModalInput}
                  type="password"
                  value={profileForm.newPassword}
                  onChange={e => setProfileForm(f => ({ ...f, newPassword: e.target.value }))}
                  placeholder="Minim 8 caractere"
                  autoComplete="new-password"
                />
              </div>
              {profileError && <p className={styles.profileModalError}>{profileError}</p>}
              {profileSuccess && <p className={styles.profileModalSuccess}>{profileSuccess}</p>}
              <button type="button" className={styles.profileModalSave} onClick={handleProfileSave} disabled={profileLoading}>
                {profileLoading ? 'Se salvează...' : 'Salvează modificările'}
              </button>
            </form>
          </div>
        </div>
      )}
      {notificationsOpen && <div className={styles.notificationsOverlay} onClick={() => setNotificationsOpen(false)} />}

      <div className={styles.pageLayout}>
        {/* Sidebar */}
        <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
          <div className={styles.sidebarLogo}>
            <span style={{fontSize:'20px',fontWeight:700,color:'#B7FF00',letterSpacing:'-0.5px',fontFamily:"'Space Grotesk', sans-serif"}}>trevano</span>
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
              <span className={styles.sidebarDot} />
            )}
          </div>

          <div className={styles.sidebarFooter}>
            <button className={styles.sidebarProfileBtn} onClick={openProfile}>
              <div className={styles.sidebarProfileAvatar}>
                {(user?.name || 'U').charAt(0).toUpperCase()}
              </div>
              <div className={styles.sidebarProfileInfo}>
                <span className={styles.sidebarProfileName}>{user?.name || 'Profil'}</span>
                <span className={styles.sidebarProfileSub}>Editează contul</span>
              </div>
            </button>
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
          <TrialBanner />
          {/* ClientsList — mereu montat ca să nu se piardă starea; ascuns când altă vedere e activă */}
          <div style={{ display: (!viewingPlanId && !viewingWorkoutPlanId && !viewingProgressClientId && !generatingPlanClientId) ? undefined : 'none' }}>
            {!addingClient && (
              <div className={styles.hero}>
                <h2 className={styles.heroHeading}>
                  Bună ziua, <span className={styles.accent}>{firstName}</span>.
                </h2>
                <p className={styles.heroSub}>
                  Gestionează clienții și generează planuri alimentare sau de antrenament.
                </p>
              </div>
            )}
            <div className={styles.clientsCard}>
              <ClientsList
                ref={clientsListRef}
                noPadding
                onViewPlan={(planId) => setViewingPlanId(planId)}
                onViewProgress={(clientId) => setViewingProgressClientId(clientId)}
                onGeneratePlan={(clientId) => setGeneratingPlanClientId(clientId)}
                onAddFormChange={(isOpen) => setAddingClient(isOpen)}
                openDeleteForClientId={deleteClientId}
                onClientSaved={() => setClientDataVersion(v => v + 1)}
                onFormClose={() => {
                  if (returnPlanId) {
                    setViewingPlanId(returnPlanId);
                    setReturnPlanId(null);
                  } else if (returnWorkoutPlanId) {
                    setViewingWorkoutPlanId(returnWorkoutPlanId);
                    setReturnWorkoutPlanId(null);
                  }
                }}
              />
            </div>
          </div>
          {viewingPlanId && !viewingWorkoutPlanId && !viewingProgressClientId && !generatingPlanClientId && (
            <div style={{ paddingTop: 12 }}>
            <InlineMealPlanView
              planId={viewingPlanId}
              clientDataVersion={clientDataVersion}
              scrollContainerRef={mainRef}
              onBack={() => setViewingPlanId(null)}
              onEditClient={(clientId) => {
                handleEditClientFromPlan(clientId, viewingPlanId, null);
              }}
              onDeleteClient={(clientId) => {
                setConfirmDeleteClientId(clientId);
              }}
              onViewProgress={(clientId) => {
                setViewingPlanId(null);
                setViewingProgressClientId(clientId);
              }}
              onViewWorkoutPlan={(workoutPlanId) => {
                setViewingPlanId(null);
                setViewingWorkoutPlanId(workoutPlanId);
              }}
            />
            </div>
          )}
          {viewingWorkoutPlanId && !viewingPlanId && !viewingProgressClientId && !generatingPlanClientId && (
            <div style={{ paddingTop: 12 }}>
            <InlineWorkoutPlanView
              planId={viewingWorkoutPlanId}
              clientDataVersion={clientDataVersion}
              scrollContainerRef={mainRef}
              onBack={() => setViewingWorkoutPlanId(null)}
              onViewMealPlan={(mealPlanId) => {
                setViewingWorkoutPlanId(null);
                setViewingPlanId(mealPlanId);
              }}
              onViewProgress={(clientId) => {
                setViewingWorkoutPlanId(null);
                setViewingProgressClientId(clientId);
              }}
              onEditClient={(clientId) => {
                handleEditClientFromPlan(clientId, null, viewingWorkoutPlanId);
              }}
              onDeleteClient={(clientId) => {
                setConfirmDeleteClientId(clientId);
              }}
            />
            </div>
          )}
          {viewingProgressClientId && (
            <div style={{ paddingTop: 12 }}>
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
            </div>
          )}
          {generatingPlanClientId && !viewingProgressClientId && !viewingWorkoutPlanId && (
            <div style={{ paddingTop: 12 }}>
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
            </div>
          )}
        </main>
      </div>
    </div>

    {/* Modal confirmare stergere client din plan view */}
    {confirmDeleteClientId && (
      <div
        onClick={() => setConfirmDeleteClientId(null)}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: '#fff', borderRadius: 16, padding: '28px 28px 24px',
            maxWidth: 360, width: '90%', textAlign: 'center',
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          }}
        >
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'rgba(255,59,48,0.1)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff3b30" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </div>
          <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 600, color: '#1d1d1f' }}>Stergi clientul?</h3>
          <p style={{ margin: '0 0 24px', fontSize: 14, color: '#6e6e73', lineHeight: 1.5 }}>
            Aceasta actiune este ireversibila. Planurile asociate vor fi sterse.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setConfirmDeleteClientId(null)}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid #e8e8ed',
                background: '#f5f5f7', color: '#3c3c43', fontSize: 14, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Anulează
            </button>
            <button
              onClick={handleConfirmDeleteFromPlan}
              disabled={deletingFromPlan}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                background: '#ff3b30', color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: deletingFromPlan ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                opacity: deletingFromPlan ? 0.7 : 1,
              }}
            >
              {deletingFromPlan ? 'Se șterge...' : 'Șterge definitiv'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute requiredRole="trainer">
      <DashboardContent />
    </ProtectedRoute>
  );
}
