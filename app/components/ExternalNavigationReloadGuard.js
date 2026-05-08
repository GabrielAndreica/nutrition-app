'use client';

import { useEffect } from 'react';

export const EXTERNAL_NAVIGATION_FLAG = 'trevano:externalNavigationInProgress';

export function markExternalNavigation() {
  sessionStorage.setItem(EXTERNAL_NAVIGATION_FLAG, '1');
}

function isBackForwardNavigation() {
  const [navigation] = performance.getEntriesByType('navigation');
  return navigation?.type === 'back_forward';
}

export default function ExternalNavigationReloadGuard() {
  useEffect(() => {
    const reloadIfRestoredFromExternal = (event) => {
      if (sessionStorage.getItem(EXTERNAL_NAVIGATION_FLAG) !== '1') return;
      if (!event.persisted && !isBackForwardNavigation()) return;

      sessionStorage.removeItem(EXTERNAL_NAVIGATION_FLAG);
      window.location.reload();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      reloadIfRestoredFromExternal({ persisted: false });
    };

    window.addEventListener('pageshow', reloadIfRestoredFromExternal);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pageshow', reloadIfRestoredFromExternal);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return null;
}
