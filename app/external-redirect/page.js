'use client';

import { useEffect, useState } from 'react';
import styles from '@/app/auth/auth.module.css';

const USED_KEY_PREFIX = 'trevano:externalRedirect:used:';

function getSafeReturnUrl(value) {
  if (!value || !value.startsWith('/')) return '/dashboard';
  if (value.startsWith('//')) return '/dashboard';
  return value;
}

export default function ExternalRedirectPage() {
  const [message, setMessage] = useState('Se redirecționează...');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const externalUrl = params.get('to');
    const redirectId = params.get('rid') || externalUrl;
    const returnUrl = getSafeReturnUrl(params.get('returnTo'));
    const usedKey = `${USED_KEY_PREFIX}${redirectId}`;

    const returnToApp = () => {
      window.location.replace(returnUrl);
    };

    const handlePageShow = () => {
      if (sessionStorage.getItem(usedKey) === '1') {
        returnToApp();
      }
    };

    window.addEventListener('pageshow', handlePageShow);

    if (!externalUrl) {
      returnToApp();
      return;
    }

    if (sessionStorage.getItem(usedKey) === '1') {
      returnToApp();
      return;
    }

    try {
      const url = new URL(externalUrl);
      if (!url.hostname.endsWith('stripe.com')) {
        throw new Error('Invalid external redirect host');
      }

      sessionStorage.setItem(usedKey, '1');
      window.location.assign(externalUrl);
    } catch {
      setMessage('Redirect invalid. Revii în aplicație...');
      returnToApp();
    }

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.loadingSpinner} />
      <p style={{ marginTop: 16 }}>{message}</p>
    </div>
  );
}
