'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { validateEmail, sanitizeInput } from '@/app/lib/validation';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './auth.module.css';

export default function AuthPage() {
  const router = useRouter();
  const { user, loading, login } = useAuth();
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({ email: [], password: [] });
  const [successMessage, setSuccessMessage] = useState('');
  const [generalError, setGeneralError] = useState('');

  useEffect(() => {
    if (!loading && user) router.push('/dashboard');
  }, [user, loading, router]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: sanitizeInput(value) }));
    setSuccessMessage('');
    setGeneralError('');
  };

  const validateForm = () => {
    const newErrors = {
      email: validateEmail(formData.email),
      password: formData.password ? [] : ['Parola este obligatorie'],
    };
    setFieldErrors(newErrors);
    return Object.values(newErrors).every(e => e.length === 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    setGeneralError('');
    setSuccessMessage('');

    if (!validateForm()) {
      setGeneralError('Corecteaza erorile inainte de a continua.');
      return;
    }

    setLoadingSubmit(true);
    try {
      const response = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email, password: formData.password }),
      });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setGeneralError(data.error || 'Email sau parola incorecta.');
        } else if (response.status === 429) {
          setGeneralError('Prea multe incercari. Incearca din nou mai tarziu.');
        } else {
          setGeneralError(data.error || 'A aparut o eroare. Incearca din nou.');
        }
        return;
      }

      setSuccessMessage('Autentificat cu succes!');
      login(data.user, data.token);
      router.push('/dashboard');
    } catch {
      setGeneralError('Eroare de retea. Verifica conexiunea si incearca din nou.');
    } finally {
      setLoadingSubmit(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingSpinner} />
      </div>
    );
  }

  return (
    <div className={styles.page}>

      <div className={styles.leftPanel}>
        <div className={styles.brand}>
          <span className={styles.logoMark}>N</span>
          <span className={styles.logoText}>NutriAI</span>
        </div>

        <div className={styles.tagline}>
          <h1 className={styles.taglineHeading}>
            Planuri alimentare<br />complet personalizate.
          </h1>
          <p className={styles.taglineSub}>
            Creaza planuri alimentare pentru clientii tai, in cateva secunde.
          </p>
        </div>

        <div className={styles.aiBadge}>
          <span className={styles.dot} />
          Nutriție inteligentă
        </div>
      </div>

      <div className={styles.rightPanel}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Autentificare</h2>
          <p className={styles.cardSub}>Bun venit inapoi.</p>

          {successMessage && (
            <div className={styles.success}>{successMessage}</div>
          )}
          {generalError && (
            <div className={styles.error}>{generalError}</div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className={styles.formGroup}>
              <label htmlFor="email">Adresa email</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="tu@exemplu.com"
                disabled={loadingSubmit}
                maxLength="254"
                autoComplete="email"
              />
              {submitted && fieldErrors.email?.length > 0 && (
                <div className={styles.fieldError}>
                  {fieldErrors.email.map((err, i) => <p key={i}>{err}</p>)}
                </div>
              )}
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="password">Parola</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="••••••••"
                disabled={loadingSubmit}
                maxLength="128"
                autoComplete="current-password"
              />
              {submitted && fieldErrors.password?.length > 0 && (
                <div className={styles.fieldError}>
                  {fieldErrors.password.map((err, i) => <p key={i}>{err}</p>)}
                </div>
              )}
            </div>

            <button type="submit" disabled={loadingSubmit} className={styles.submitBtn}>
              {loadingSubmit
                ? <><span className={styles.spinner} />Se autentifica...</>
                : 'Autentificare'
              }
            </button>
          </form>
        </div>
      </div>

    </div>
  );
}
