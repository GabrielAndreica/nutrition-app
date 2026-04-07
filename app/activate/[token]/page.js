'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './activate.module.css';

export default function ActivatePage({ params }) {
  const router = useRouter();
  const { login } = useAuth();
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(true);
  const [activating, setActivating] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [invitationData, setInvitationData] = useState(null);
  
  const [formData, setFormData] = useState({
    name: '',
    password: '',
    confirmPassword: '',
  });

  const [fieldErrors, setFieldErrors] = useState({
    name: [],
    password: [],
    confirmPassword: [],
  });

  // Extrage token din params
  useEffect(() => {
    params.then(p => {
      setToken(p.token);
    });
  }, [params]);

  // Validează token
  useEffect(() => {
    if (!token) return;

    const validateToken = async () => {
      try {
        const res = await fetch(`/api/activate/${token}`);
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || 'Token invalid.');
          setValidating(false);
          return;
        }

        setInvitationData(data);
        setValidating(false);
        setLoading(false);
      } catch (err) {
        console.error('Eroare la validarea token:', err);
        setError('Eroare la validarea invitației.');
        setValidating(false);
      }
    };

    validateToken();
  }, [token]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError('');
    setSuccessMessage('');
  };

  const validateForm = () => {
    const newErrors = {
      name: invitationData?.clientName || formData.name.trim() ? [] : ['Numele este obligatoriu'],
      password: formData.password.length >= 8 
        ? [] 
        : ['Parola trebuie să aibă cel puțin 8 caractere'],
      confirmPassword: formData.password === formData.confirmPassword 
        ? [] 
        : ['Parolele nu coincid'],
    };
    setFieldErrors(newErrors);
    return Object.values(newErrors).every(e => e.length === 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    setError('');
    setSuccessMessage('');

    if (!validateForm()) {
      return;
    }

    setActivating(true);

    try {
      const res = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name: invitationData?.clientName || formData.name,
          password: formData.password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Eroare la activarea contului.');
        setActivating(false);
        return;
      }

      setSuccessMessage('Cont activat cu succes!');

      // Salvează token, actualizează contextul React și redirecționează
      login(data.user, data.token);

      // Redirecționează către dashboard client
      router.push('/client/dashboard');
    } catch (err) {
      console.error('Eroare la activare:', err);
      setError('Eroare la activarea contului.');
      setActivating(false);
    }
  };

  if (validating) {
    return (
      <div className={styles.container}>
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
              Activează-ți contul și începe să colaborezi cu antrenorul tău pentru rezultate optime.
            </p>
          </div>
          <div className={styles.aiBadge}>
            <span className={styles.dot} />
            Nutriție inteligentă
          </div>
        </div>
        <div className={styles.rightPanel}>
          <div className={styles.card}>
            <div className={styles.loader}></div>
            <p className={styles.loadingText}>Validare invitație...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !invitationData) {
    return (
      <div className={styles.container}>
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
              Activează-ți contul și începe să colaborezi cu antrenorul tău pentru rezultate optime.
            </p>
          </div>
          <div className={styles.aiBadge}>
            <span className={styles.dot} />
            Nutriție inteligentă
          </div>
        </div>
        <div className={styles.rightPanel}>
          <div className={styles.card}>
            <div className={styles.errorIcon}>✕</div>
            <h1 className={styles.title}>Invitație invalidă</h1>
            <button
              onClick={() => router.push('/auth')}
              className={styles.button}
            >
              Înapoi la autentificare
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
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
            Activează-ți contul și începe să colaborezi cu antrenorul tău pentru rezultate optime.
          </p>
        </div>
        <div className={styles.aiBadge}>
          <span className={styles.dot} />
          Nutriție inteligentă
        </div>
      </div>
      <div className={styles.rightPanel}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Activare cont</h2>
          <p className={styles.cardSub}>Activează-ți contul și începe.</p>

          {successMessage && (
            <div className={styles.success}>{successMessage}</div>
          )}
          {error && <div className={styles.error}>{error}</div>}

          {invitationData && (
            <div className={styles.infoBox}>
              <p><strong>Email:</strong> {invitationData.email}</p>
              {invitationData.clientName && (
                <p><strong>Profil:</strong> {invitationData.clientName}</p>
              )}
            </div>
          )}

        <form onSubmit={handleSubmit} noValidate>
          {!invitationData?.clientName && (
            <div className={styles.formGroup}>
              <label htmlFor="name">
                Numele tău complet
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="ex: Ion Popescu"
                required
                disabled={activating}
              />
              {submitted && fieldErrors.name?.length > 0 && (
                <div className={styles.fieldError}>
                  {fieldErrors.name.map((err, i) => <p key={i}>{err}</p>)}
                </div>
              )}
            </div>
          )}

          <div className={styles.formGroup}>
            <label htmlFor="password">
              Parolă
            </label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleInputChange}
              placeholder="Minim 8 caractere"
              required
              disabled={activating}
            />
            {submitted && fieldErrors.password?.length > 0 && (
              <div className={styles.fieldError}>
                {fieldErrors.password.map((err, i) => <p key={i}>{err}</p>)}
              </div>
            )}
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="confirmPassword">
              Confirmă parola
            </label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleInputChange}
              placeholder="Reintroduceți parola"
              required
              disabled={activating}
            />
            {submitted && fieldErrors.confirmPassword?.length > 0 && (
              <div className={styles.fieldError}>
                {fieldErrors.confirmPassword.map((err, i) => <p key={i}>{err}</p>)}
              </div>
            )}
          </div>

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={activating}
          >
            {activating ? (
              <>
                <span className={styles.spinner} />
                Activare...
              </>
            ) : (
              'Activează contul'
            )}
          </button>
        </form>

        </div>
      </div>
    </div>
  );
}
