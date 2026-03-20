'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  validateEmail, 
  sanitizeInput 
} from '@/app/lib/validation';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from './auth.module.css';

export default function AuthPage() {
  const router = useRouter();
  const { user, loading, login } = useAuth();
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const [fieldErrors, setFieldErrors] = useState({
    email: [],
    password: [],
  });

  const [successMessage, setSuccessMessage] = useState('');
  const [generalError, setGeneralError] = useState('');

  // Redirect to dashboard if already logged in
  useEffect(() => {
    if (!loading && user) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingSpinner}></div>
      </div>
    );
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const sanitized = sanitizeInput(value);
    
    setFormData(prev => ({
      ...prev,
      [name]: sanitized,
    }));

    setSuccessMessage('');
    setGeneralError('');
  };

  const validateForm = () => {
    const newErrors = {};

    newErrors.email = validateEmail(formData.email);
    if (!formData.password) {
      newErrors.password = ['Password is required'];
    } else {
      newErrors.password = [];
    }

    setFieldErrors(newErrors);

    // Check if any field has errors
    return Object.values(newErrors).every(errors => errors.length === 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    setGeneralError('');
    setSuccessMessage('');

    if (!validateForm()) {
      setGeneralError('Please fix all errors before submitting');
      return;
    }

    setLoadingSubmit(true);

    try {
      const response = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle specific error messages from API
        if (response.status === 401) {
          setGeneralError(data.error || 'Invalid credentials');
        } else if (response.status === 429) {
          setGeneralError('Too many login attempts. Please try again later.');
        } else {
          setGeneralError(data.error || 'An error occurred. Please try again.');
        }
        setLoadingSubmit(false);
        return;
      }

      // Success
      setSuccessMessage('Logged in successfully!');
      
      // Use login method from AuthContext with token
      login(data.user, data.token);
      router.push('/dashboard');
    } catch (err) {
      console.error('Auth error:', err);
      setGeneralError('Network error. Please check your connection and try again.');
      setLoadingSubmit(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1>Sign In</h1>
        <p>Welcome back!</p>

        {successMessage && (
          <div className={styles.success}>✓ {successMessage}</div>
        )}

        {generalError && (
          <div className={styles.error}>⚠ {generalError}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              placeholder="you@example.com"
              disabled={loadingSubmit}
              maxLength="254"
            />
            {submitted && fieldErrors.email && fieldErrors.email.length > 0 && (
              <div className={styles.fieldError}>
                {fieldErrors.email.map((error, idx) => (
                  <p key={idx}>• {error}</p>
                ))}
              </div>
            )}
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleInputChange}
              placeholder="••••••••"
              disabled={loadingSubmit}
              maxLength="128"
            />
            {submitted && fieldErrors.password && fieldErrors.password.length > 0 && (
              <div className={styles.fieldError}>
                {fieldErrors.password.map((error, idx) => (
                  <p key={idx}>• {error}</p>
                ))}
              </div>
            )}
          </div>

          <button 
            type="submit" 
            disabled={loadingSubmit}
            className={styles.submitBtn}
          >
            {loadingSubmit ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
