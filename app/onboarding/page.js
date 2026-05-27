'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from '@/app/auth/auth.module.css';
import Link from 'next/link';

const TOTAL_STEPS = 3;

const FITNESS_LEVELS = [
  { value: 'beginner', label: 'Începător', desc: 'Sub 6 luni de antrenament' },
  { value: 'intermediate', label: 'Intermediar', desc: '6 luni – 2 ani' },
  { value: 'advanced', label: 'Avansat', desc: 'Peste 2 ani de antrenament' },
];

const LOCATIONS = [
  { value: 'gym', label: 'Sală de fitness' },
  { value: 'home', label: 'Acasă' },
];

const GOALS = [
  { value: 'weight_loss', label: 'Slăbire', desc: 'Ard grăsime și slăbesc' },
  { value: 'muscle_gain', label: 'Masă musculară', desc: 'Cresc masa musculară' },
  { value: 'maintenance', label: 'Menținere', desc: 'Îmi mențin greutatea actuală' },
];

const DIET_TYPES = [
  { value: 'omnivore', label: 'Omnivor', desc: 'Carne, pește, lactate, ouă' },
  { value: 'vegetarian', label: 'Vegetarian', desc: 'Fără carne sau pește' },
  { value: 'vegan', label: 'Vegan', desc: 'Fără produse animale' },
];

const STEP_LABELS = ['Date personale', 'Antrenament', 'Obiectiv'];

const btnToggle = (active) => ({
  flex: 1,
  padding: '11px 8px',
  borderRadius: 10,
  border: `2px solid ${active ? '#7fc800' : '#e0e0e0'}`,
  background: active ? 'rgba(127,200,0,0.1)' : '#f7f7f7',
  color: active ? '#3d5200' : '#444',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  transition: 'all 0.15s',
  textAlign: 'center',
  fontFamily: 'inherit',
});

const cardToggle = (active) => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '11px 14px',
  borderRadius: 10,
  border: `2px solid ${active ? '#7fc800' : '#e0e0e0'}`,
  background: active ? 'rgba(127,200,0,0.1)' : '#f7f7f7',
  color: active ? '#3d5200' : '#333',
  cursor: 'pointer',
  transition: 'all 0.15s',
  fontFamily: 'inherit',
  marginBottom: 8,
});

export default function OnboardingPage() {
  const router = useRouter();
  const { user, token, loading: authLoading, login } = useAuth();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationMessage, setGenerationMessage] = useState('');

  const [form, setForm] = useState({
    gender: 'M',
    age: '',
    height: '',
    weight: '',
    fitnessLevel: 'beginner',
    workoutsPerWeek: 3,
    trainingLocation: 'gym',
    goal: 'muscle_gain',
    dietType: 'omnivore',
  });

  // Verifică statusul onboarding din BD, nu din localStorage
  useEffect(() => {
    if (authLoading) return;
    if (generating) return; // Nu redirecționa în timp ce se generează planurile

    if (!user) {
      // Nu e autentificat → du-l la login
      router.replace('/auth');
      return;
    }

    if (user.role !== 'user') {
      router.replace(user.role === 'client' ? '/client/dashboard' : '/dashboard');
      return;
    }

    // Verifică din BD dacă a completat deja onboarding-ul
    const tok = token || localStorage.getItem('token');
    fetch('/api/user/onboarding', {
      headers: { 'Authorization': `Bearer ${tok}` },
    })
      .then(res => res.json())
      .then(data => {
        if (data.onboarding_completed) {
          router.replace('/client/dashboard');
        } else {
          setAuthChecked(true);
        }
      })
      .catch(() => setAuthChecked(true));
  }, [authLoading, user, router, token]);

  const updateForm = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const validateStep = () => {
    if (step === 1) {
      if (!form.age || Number(form.age) < 14 || Number(form.age) > 100)
        return 'Introdu o vârstă validă (14–100 ani).';
      if (!form.height || Number(form.height) < 120 || Number(form.height) > 230)
        return 'Introdu o înălțime validă (120–230 cm).';
      if (!form.weight || Number(form.weight) < 30 || Number(form.weight) > 300)
        return 'Introdu o greutate validă (30–300 kg).';
    }
    return null;
  };

  const handleNext = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError('');
    setStep(s => s + 1);
  };

  const handleBack = () => {
    setError('');
    setStep(s => s - 1);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      // Pas 1: Salvează datele de onboarding
      const res = await fetch('/api/user/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Eroare la salvarea profilului.');

      const { clientId } = data;

      // Pas 2: Generează planul alimentar (și automat planul de antrenament)
      setGenerating(true);
      setGenerationProgress(5);
      setGenerationMessage('Se inițializează generarea...');

      const activityMap = { 2: 'light', 3: 'moderate', 4: 'moderate', 5: 'very_active', 6: 'very_active' };
      const mealPayload = {
        clientId,
        name: user?.name || 'Utilizator',
        age: Number(form.age),
        weight: Number(form.weight),
        height: Number(form.height),
        gender: form.gender,
        goal: form.goal,
        activityLevel: activityMap[Number(form.workoutsPerWeek)] || 'moderate',
        dietType: form.dietType,
        allergies: [],
        mealsPerDay: 3,
        foodPreferences: '',
      };

      const genRes = await fetch('/api/generate-meal-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(mealPayload),
      });

      if (!genRes.ok) {
        const errData = await genRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Eroare la generarea planului.');
      }

      // Citește stream-ul de progres
      const reader = genRes.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.type === 'progress') {
                setGenerationProgress(event.progress || 0);
                setGenerationMessage(event.message || '');
              } else if (event.type === 'complete') {
                setGenerationProgress(100);
                setGenerationMessage('Planurile au fost generate cu succes!');
              } else if (event.type === 'error') {
                throw new Error(event.message || 'Eroare la generare.');
              }
            } catch (parseErr) {
              // linie invalidă, ignorăm
            }
          }
        }
      }

      // Actualizează direct în localStorage fără a schimba starea React (evită re-trigger useEffect)
      try {
        const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({ ...storedUser, onboarding_completed: true }));
      } catch { /* ignore */ }
      setTimeout(() => router.push('/client/dashboard'), 800);
    } catch (err) {
      setError(err.message || 'A apărut o eroare. Încearcă din nou.');
      setGenerating(false);
      setLoading(false);
    }
  };

  if (authLoading || !authChecked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
        <div style={{ width: 28, height: 28, border: '3px solid #e8e8e8', borderTop: '3px solid #7fc800', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (generating) {
    return (
      <div className={styles.page}>
        <div className={styles.leftPanel}>
          <div className={styles.brand}>
            <Link href="/" className={styles.brandLink}><span className={styles.logoText}>trevano</span></Link>
          </div>
          <div className={styles.tagline} style={{ marginTop: 'auto', marginBottom: 'auto' }}>
            <h1 className={styles.taglineHeading}>Planurile tale<br />sunt gata în curând.</h1>
            <p className={styles.taglineSub}>AI-ul nostru generează planuri personalizate pentru tine.</p>
          </div>
        </div>
        <div className={styles.rightPanel}>
          <div className={styles.card} style={{ textAlign: 'center' }}>
            <h2 className={styles.cardTitle}>Generare planuri</h2>
            <p className={styles.cardSub} style={{ marginBottom: 28 }}>{generationMessage || 'Se procesează...'}</p>
            <div style={{ background: '#e8e8e8', borderRadius: 8, height: 8, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 8, background: '#7fc800', width: `${generationProgress}%`, transition: 'width 0.4s ease' }} />
            </div>
            <p style={{ fontSize: 13, color: '#aaa' }}>{Math.round(generationProgress)}%</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.leftPanel}>
        <div className={styles.brand}>
          <Link href="/" className={styles.brandLink}>
            <span className={styles.logoText}>trevano</span>
          </Link>
        </div>
        <div className={styles.tagline} style={{ marginTop: 'auto', marginBottom: 'auto' }}>
          <h1 className={styles.taglineHeading}>Personalizăm<br />planul tău.</h1>
          <p className={styles.taglineSub}>
            Răspunde la câteva întrebări rapide și primești un plan alimentar și de antrenament creat special pentru tine.
          </p>
        </div>
      </div>

      <div className={styles.rightPanel}>
        {/* Card cu înălțime fixă uniformă pentru toți pașii */}
        <div className={styles.card} style={{ display: 'flex', flexDirection: 'column', minHeight: 500 }}>

          {/* Indicator pași — mereu sus */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexShrink: 0 }}>
            {STEP_LABELS.map((label, i) => {
              const idx = i + 1;
              const isActive = idx === step;
              const isDone = idx < step;
              return (
                <div key={idx} style={{ flex: 1 }}>
                  <div style={{ height: 3, borderRadius: 3, background: isDone || isActive ? '#7fc800' : '#e8e8e8', marginBottom: 5, transition: 'background 0.3s' }} />
                  <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500, color: isActive ? '#3d5200' : isDone ? '#aaa' : '#ccc', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block' }}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Conținut pas — se extinde să umple spațiul disponibil */}
          <div style={{ flex: 1 }}>

            {/* ── Pasul 1: Date personale ── */}
            {step === 1 && (
              <>
                <h2 className={styles.cardTitle} style={{ marginBottom: 4 }}>Date personale</h2>
                <p className={styles.cardSub} style={{ marginBottom: 18 }}>Completează datele pentru calculul caloric.</p>

                <div className={styles.formGroup}>
                  <label>Gen</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[{ v: 'M', l: 'Masculin' }, { v: 'F', l: 'Feminin' }].map(({ v, l }) => (
                      <button key={v} type="button" onClick={() => updateForm('gender', v)} style={btnToggle(form.gender === v)}>{l}</button>
                    ))}
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="age">Vârstă (ani)</label>
                  <input type="number" id="age" className={styles.formGroup}
                    value={form.age} onChange={e => updateForm('age', e.target.value)}
                    placeholder="Ex: 25" min="14" max="100"
                    style={{ width: '100%', padding: '13px', border: '1.5px solid #e5e5e5', borderRadius: 13, fontSize: 15, background: '#fafafa', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color 0.2s' }}
                    onFocus={e => e.target.style.borderColor = '#7fc800'}
                    onBlur={e => e.target.style.borderColor = '#e5e5e5'} />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="height">Înălțime (cm)</label>
                  <input type="number" id="height"
                    value={form.height} onChange={e => updateForm('height', e.target.value)}
                    placeholder="Ex: 175" min="120" max="230"
                    style={{ width: '100%', padding: '13px', border: '1.5px solid #e5e5e5', borderRadius: 13, fontSize: 15, background: '#fafafa', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color 0.2s' }}
                    onFocus={e => e.target.style.borderColor = '#7fc800'}
                    onBlur={e => e.target.style.borderColor = '#e5e5e5'} />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="weight">Greutate (kg)</label>
                  <input type="number" id="weight"
                    value={form.weight} onChange={e => updateForm('weight', e.target.value)}
                    placeholder="Ex: 75" min="30" max="300" step="0.1"
                    style={{ width: '100%', padding: '13px', border: '1.5px solid #e5e5e5', borderRadius: 13, fontSize: 15, background: '#fafafa', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color 0.2s' }}
                    onFocus={e => e.target.style.borderColor = '#7fc800'}
                    onBlur={e => e.target.style.borderColor = '#e5e5e5'} />
                </div>
              </>
            )}

            {/* ── Pasul 2: Antrenament ── */}
            {step === 2 && (
              <>
                <h2 className={styles.cardTitle} style={{ marginBottom: 4 }}>Antrenament</h2>
                <p className={styles.cardSub} style={{ marginBottom: 20 }}>Spune-ne despre experiența și stilul tău de antrenament.</p>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 7, fontSize: 13, fontWeight: 600, color: '#555' }}>Nivel de experiență</label>
                  {FITNESS_LEVELS.map(fl => (
                    <button key={fl.value} type="button" onClick={() => updateForm('fitnessLevel', fl.value)} style={cardToggle(form.fitnessLevel === fl.value)}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{fl.label}</span>
                      <span style={{ display: 'block', fontSize: 12, color: form.fitnessLevel === fl.value ? '#5a7a00' : '#888', marginTop: 1 }}>{fl.desc}</span>
                    </button>
                  ))}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 7, fontSize: 13, fontWeight: 600, color: '#555' }}>Antrenamente pe săptămână</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[2, 3, 4, 5, 6].map(n => (
                      <button key={n} type="button" onClick={() => updateForm('workoutsPerWeek', n)}
                        style={{ ...btnToggle(form.workoutsPerWeek === n), flexDirection: 'column', padding: '10px 4px', gap: 2 }}>
                        <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{n}</span>
                        <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.7 }}>zile</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 7, fontSize: 13, fontWeight: 600, color: '#555' }}>Unde te antrenezi?</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {LOCATIONS.map(loc => (
                      <button key={loc.value} type="button" onClick={() => updateForm('trainingLocation', loc.value)} style={btnToggle(form.trainingLocation === loc.value)}>{loc.label}</button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ── Pasul 3: Obiectiv și dietă ── */}
            {step === 3 && (
              <>
                <h2 className={styles.cardTitle} style={{ marginBottom: 4 }}>Obiectiv și dietă</h2>
                <p className={styles.cardSub} style={{ marginBottom: 20 }}>Ce vrei să obții și cum te alimentezi?</p>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 7, fontSize: 13, fontWeight: 600, color: '#555' }}>Obiectiv principal</label>
                  {GOALS.map(g => (
                    <button key={g.value} type="button" onClick={() => updateForm('goal', g.value)} style={cardToggle(form.goal === g.value)}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: form.goal === g.value ? '#3d5200' : '#222' }}>{g.label}</span>
                      <span style={{ display: 'block', fontSize: 12, color: form.goal === g.value ? '#5a7a00' : '#888', marginTop: 1 }}>{g.desc}</span>
                    </button>
                  ))}
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: 7, fontSize: 13, fontWeight: 600, color: '#555' }}>Tip de dietă</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {DIET_TYPES.map(d => (
                      <button key={d.value} type="button" onClick={() => updateForm('dietType', d.value)} style={btnToggle(form.dietType === d.value)}>{d.label}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Eroare */}
          {error && (
            <p style={{ fontSize: 13, color: '#e53e3e', marginTop: 14, fontWeight: 500 }}>{error}</p>
          )}

          {/* Butoane — mereu la baza cardului */}
          <div style={{ display: 'flex', gap: 10, marginTop: 24, flexShrink: 0 }}>
            {step > 1 && (
              <button type="button" onClick={handleBack} disabled={loading}
                style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: '2px solid #e0e0e0', background: '#f7f7f7', color: '#555', cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: 'inherit' }}>
                Înapoi
              </button>
            )}
            {step < TOTAL_STEPS ? (
              <button type="button" onClick={handleNext} className={styles.submitBtn} style={{ flex: step > 1 ? 2 : 1 }}>
                Continuă →
              </button>
            ) : (
              <button type="button" onClick={handleSubmit} disabled={loading} className={styles.submitBtn} style={{ flex: step > 1 ? 2 : 1 }}>
                {loading ? 'Se procesează...' : 'Generează planul meu'}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
