'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import styles from '@/app/auth/auth.module.css';

export default function ConfirmPage() {
  const { token } = useParams();
  const router = useRouter();
  const [state, setState] = useState('loading'); // 'loading' | 'success' | 'error' | 'expired'
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) { setState('error'); setMessage('Token lipsă.'); return; }

    fetch(`/api/auth/confirm/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setState('success');
          setMessage(data.message || 'Email confirmat!');
          // Redirect to login after 3 seconds
          setTimeout(() => router.push('/auth?confirmed=1'), 3000);
        } else if (res.status === 410) {
          setState('expired');
          setMessage(data.error);
        } else {
          setState('error');
          setMessage(data.error || 'A apărut o eroare.');
        }
      })
      .catch(() => { setState('error'); setMessage('Eroare de rețea. Încearcă din nou.'); });
  }, [token, router]);

  const stateColor = { loading: '#888', success: '#22c55e', error: '#ef4444', expired: '#f59e0b' }[state];
  const title = {
    loading: 'Se verifică...',
    success: 'Email confirmat!',
    error: 'Link invalid',
    expired: 'Link expirat',
  }[state];

  return (
    <div className={styles.page}>
      <div className={styles.leftPanel}>
        <div className={styles.brand}>
          <Link href="/" className={styles.brandLink}>
            <span className={styles.logoText}>trevano</span>
          </Link>
        </div>
        <div className={styles.tagline}>
          <h1 className={styles.taglineHeading}>Activare cont</h1>
          <p className={styles.taglineSub}>Îți confirmăm adresa de email.</p>
        </div>
        <div className={styles.aiBadge}>
          <span className={styles.dot} />
          Securizat
        </div>
      </div>

      <div className={styles.rightPanel}>
        <div className={styles.card} style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: stateColor, margin: '0 auto 20px', opacity: state === 'loading' ? 0.4 : 1, transition: 'background 0.3s' }} />
          <h2 className={styles.cardTitle}>{title}</h2>
          <p className={styles.cardSub} style={{ marginBottom: 24 }}>{message}</p>

          {state === 'success' && (
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
              Vei fi redirecționat automat în câteva secunde...
            </p>
          )}

          {(state === 'error' || state === 'expired') && (
            <Link href="/register" className={styles.submitBtn} style={{ display: 'inline-block', textDecoration: 'none' }}>
              Înregistrează-te din nou
            </Link>
          )}

          {state !== 'loading' && (
            <div style={{ marginTop: 20 }}>
              <Link href="/auth" style={{ color: '#666', fontSize: 13, textDecoration: 'underline' }}>
                ← Mergi la autentificare
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
