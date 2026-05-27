'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import styles from '../auth.module.css';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) setError('Link invalid. Solicită un nou link de resetare.');
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Parola trebuie să aibă cel puțin 8 caractere.'); return; }
    if (password !== confirmPassword) { setError('Parolele nu se potrivesc.'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'A apărut o eroare.'); return; }
      setSuccess(true);
    } catch {
      setError('Eroare de rețea. Încearcă din nou.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.leftPanel}>
        <div className={styles.brand}>
          <span className={styles.logoMark}>t</span>
          <span className={styles.logoText}>trevano</span>
        </div>
        <div className={styles.tagline}>
          <h1 className={styles.taglineHeading}>Parolă nouă,<br />cont securizat.</h1>
          <p className={styles.taglineSub}>Alege o parolă puternică pentru contul tău.</p>
        </div>

      </div>

      <div className={styles.rightPanel}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Parolă nouă</h2>
          <p className={styles.cardSub}>Introdu noua ta parolă mai jos.</p>

          {success ? (
            <>
              <div className={styles.success}>Parola a fost resetată cu succes!</div>
              <button className={styles.submitBtn} onClick={() => router.push('/auth')} style={{ marginTop: '8px' }}>
                Mergi la autentificare
              </button>
            </>
          ) : (
            <>
              {error && <div className={styles.error}>{error}</div>}
              {!error || token ? (
                <form onSubmit={handleSubmit} noValidate>
                  <div className={styles.formGroup}>
                    <label htmlFor="password">Parola nouă</label>
                    <input
                      type="password"
                      id="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Minim 8 caractere"
                      disabled={loading}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label htmlFor="confirmPassword">Confirmă parola</label>
                    <input
                      type="password"
                      id="confirmPassword"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Repetă parola"
                      disabled={loading}
                      autoComplete="new-password"
                    />
                  </div>
                  <button type="submit" disabled={loading || !token} className={styles.submitBtn}>
                    {loading ? <><span className={styles.spinner} />Se salvează...</> : 'Setează parola nouă'}
                  </button>
                </form>
              ) : null}

            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  );
}
