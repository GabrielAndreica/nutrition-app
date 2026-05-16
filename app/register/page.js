'use client';

import { useState } from 'react';
import Link from 'next/link';
import styles from '@/app/auth/auth.module.css';
import localStyles from './register.module.css';

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    terms: false,
    privacy: false,
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [generalError, setGeneralError] = useState('');

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    setErrors((prev) => ({
      ...prev,
      [name]: '',
      ...(name === 'password' || name === 'confirmPassword' ? { confirmPassword: '' } : {}),
    }));
    setGeneralError('');
  };

  const validate = () => {
    const errs = {};
    if (!formData.name.trim() || formData.name.trim().length < 2) errs.name = 'Numele trebuie să aibă cel puțin 2 caractere.';
    if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errs.email = 'Adresă de email invalidă.';
    if (!formData.password || formData.password.length < 8) errs.password = 'Parola trebuie să aibă cel puțin 8 caractere.';
    if (!formData.confirmPassword) errs.confirmPassword = 'Confirmă parola.';
    else if (formData.password !== formData.confirmPassword) errs.confirmPassword = 'Parolele nu se potrivesc.';
    if (formData.phone) {
      const digits = formData.phone.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) errs.phone = 'Număr de telefon invalid.';
    }
    if (!formData.terms) errs.terms = 'Trebuie să accepți termenii și condițiile.';
    if (!formData.privacy) errs.privacy = 'Trebuie să accepți politica de confidențialitate.';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGeneralError('');

    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          phone: formData.phone,
          terms: formData.terms,
          privacy: formData.privacy,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.field) setErrors((prev) => ({ ...prev, [data.field]: data.error }));
        else setGeneralError(data.error || 'A apărut o eroare. Încearcă din nou.');
        return;
      }

      setSuccess(true);
    } catch {
      setGeneralError('Eroare de rețea. Verifică conexiunea și încearcă din nou.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      {/* Left branding panel */}
      <div className={styles.leftPanel}>
        <div className={styles.brand}>
          <Link href="/" className={styles.brandLink}>
            <span className={styles.logoText}>trevano</span>
          </Link>
        </div>
        <div className={styles.tagline}>
          <h1 className={styles.taglineHeading}>
            Pentru antrenori<br />de fitness.
          </h1>
          <p className={styles.taglineSub}>
            Gestionează clienții, planurile alimentare, antrenamentele și progresul într-un singur loc.
          </p>
        </div>
        <div className={styles.aiBadge}>
          <span className={styles.dot} />
          Gratuit 14 zile
        </div>
      </div>

      {/* Right form panel */}
      <div className={styles.rightPanel}>
        <div className={styles.card}>
          {success ? (
            <div className={localStyles.successState}>
              <h2 className={styles.cardTitle}>Verifică emailul</h2>
              <p className={styles.cardSub}>
                Ți-am trimis un link de confirmare la <strong>{formData.email}</strong>.<br />
                Linkul expiră în 24 de ore.
              </p>
              <Link href="/auth" className={localStyles.backLink}>Mergi la autentificare</Link>
            </div>
          ) : (
            <>
              <h2 className={styles.cardTitle}>Creează cont</h2>
              <p className={styles.cardSub}>
                Ai deja cont?{' '}
                <Link href="/auth" className={localStyles.inlineLink}>Autentifică-te</Link>
              </p>

              {generalError && <div className={styles.error}>{generalError}</div>}

              <form onSubmit={handleSubmit} noValidate>
                {/* Name */}
                <div className={styles.formGroup}>
                  <label htmlFor="name">Nume complet</label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="Ion Popescu"
                    disabled={loading}
                    autoComplete="name"
                    maxLength="100"
                  />
                  {errors.name && <div className={styles.fieldError}><p>{errors.name}</p></div>}
                </div>

                {/* Email */}
                <div className={styles.formGroup}>
                  <label htmlFor="email">Adresă email</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="tu@exemplu.com"
                    disabled={loading}
                    autoComplete="email"
                    maxLength="254"
                  />
                  {errors.email && <div className={styles.fieldError}><p>{errors.email}</p></div>}
                </div>

                {/* Password */}
                <div className={styles.formGroup}>
                  <label htmlFor="password">Parolă <span className={localStyles.hint}>(min. 8 caractere)</span></label>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    disabled={loading}
                    autoComplete="new-password"
                    maxLength="128"
                  />
                  {errors.password && <div className={styles.fieldError}><p>{errors.password}</p></div>}
                </div>

                {/* Confirm password */}
                <div className={styles.formGroup}>
                  <label htmlFor="confirmPassword">Confirmă parola</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="••••••••"
                    disabled={loading}
                    autoComplete="new-password"
                    maxLength="128"
                  />
                  {errors.confirmPassword && <div className={styles.fieldError}><p>{errors.confirmPassword}</p></div>}
                </div>

                {/* Phone (optional) */}
                <div className={styles.formGroup}>
                  <label htmlFor="phone">
                    Telefon <span className={localStyles.hint}>(opțional)</span>
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="+40 712 345 678"
                    disabled={loading}
                    autoComplete="tel"
                    maxLength="20"
                  />
                  {errors.phone && <div className={styles.fieldError}><p>{errors.phone}</p></div>}
                </div>

                {/* Terms */}
                <div className={localStyles.checkGroup}>
                  <label className={localStyles.checkLabel}>
                    <input
                      type="checkbox"
                      name="terms"
                      checked={formData.terms}
                      onChange={handleChange}
                      disabled={loading}
                    />
                    <span>
                      Am citit și accept{' '}
                      <Link href="/termeni-si-conditii" target="_blank" rel="noopener noreferrer" className={localStyles.inlineLink}>
                        Termenii și Condițiile
                      </Link>
                    </span>
                  </label>
                  {errors.terms && <div className={styles.fieldError}><p>{errors.terms}</p></div>}
                </div>

                {/* Privacy */}
                <div className={localStyles.checkGroup}>
                  <label className={localStyles.checkLabel}>
                    <input
                      type="checkbox"
                      name="privacy"
                      checked={formData.privacy}
                      onChange={handleChange}
                      disabled={loading}
                    />
                    <span>
                      Am citit și accept{' '}
                      <Link href="/politica-de-confidentialitate" target="_blank" rel="noopener noreferrer" className={localStyles.inlineLink}>
                        Politica de Confidențialitate
                      </Link>
                    </span>
                  </label>
                  {errors.privacy && <div className={styles.fieldError}><p>{errors.privacy}</p></div>}
                </div>

                <button type="submit" disabled={loading} className={styles.submitBtn}>
                  {loading ? (
                    <><span className={styles.spinner} />Se creează contul...</>
                  ) : (
                    'Creează cont gratuit →'
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
