'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import styles from '@/app/auth/auth.module.css';
import clientStyles from '@/app/clients/clients.module.css';
import dashStyles from '@/app/client/dashboard/dashboard.module.css';
import Link from 'next/link';

const fireConfetti = async () => {
  const confetti = (await import('canvas-confetti')).default;
  confetti({ particleCount: 120, spread: 80, origin: { y: 0.55 }, colors: ['#b7ff00', '#0a0a0a', '#fff', '#7fc800'] });
};

function getLevelInfoFromXp(xp) {
  const totalXp = Math.max(0, Number(xp) || 0);
  let level = 1;
  while (((level + 1) * level) / 2 * 100 <= totalXp) level++;
  const xpStartOfLevel = (level * (level - 1)) / 2 * 100;
  const xpForNextLevel = level * 100;
  const xpInCurrentLevel = totalXp - xpStartOfLevel;
  const progressPct = Math.min(100, Math.round((xpInCurrentLevel / xpForNextLevel) * 100));
  return { level, totalXp, xpInCurrentLevel, xpForNextLevel, progressPct };
}

function getLevelUpPayload(previousLevelInfo, nextLevelInfo, xpAdded = 50) {
  if (!nextLevelInfo?.level) return null;
  const previous = previousLevelInfo || getLevelInfoFromXp((Number(nextLevelInfo.totalXp) || 0) - xpAdded);
  if (!previous?.level || nextLevelInfo.level <= previous.level) return null;
  return { fromLevel: previous.level, toLevel: nextLevelInfo.level, levelInfo: nextLevelInfo };
}

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
  const [xpReward, setXpReward] = useState(null);   // { levelInfo }
  const [levelUpReward, setLevelUpReward] = useState(null); // { fromLevel, toLevel, levelInfo }
  const [direction, setDirection] = useState(null); // null = no animation on first render

  const [form, setForm] = useState({
    name: '',
    gender: 'M',
    age: '',
    height: '',
    weight: '',
    fitnessLevel: 'beginner',
    workoutsPerWeek: 3,
    trainingLocation: 'gym',
    goal: 'muscle_gain',
  });

  // Verifică statusul onboarding din BD, nu din localStorage
  useEffect(() => {
    if (authLoading) return;
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
      if (!form.name || form.name.trim().length < 2)
        return 'Introdu un nume de cel puțin 2 caractere.';
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
    setDirection('forward');
    setStep(s => s + 1);
  };

  const handleBack = () => {
    setError('');
    setDirection('back');
    setStep(s => s - 1);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      // Salvează datele de onboarding
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

      // Marchează onboarding-ul ca finalizat în localStorage
      try {
        const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({ ...storedUser, onboarding_completed: true }));
      } catch { /* ignore */ }

      // Acordă 50 XP pentru finalizarea înscrierii
      try {
        const xpRes = await fetch('/api/user/xp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ amount: 50 }),
        });
        const xpData = await xpRes.json();
        const levelInfo = xpData?.level ? xpData : getLevelInfoFromXp(50);
        const levelUp = getLevelUpPayload(getLevelInfoFromXp(0), levelInfo, 50);

        // Salvează reward-ul în localStorage — dashboard-ul îl va afișa după redirect
        try {
          if (levelUp) {
            localStorage.setItem('pendingOnboardingReward', JSON.stringify({ type: 'levelUp', ...levelUp }));
          } else {
            localStorage.setItem('pendingOnboardingReward', JSON.stringify({ type: 'xp', levelInfo }));
          }
        } catch { /* ignore */ }
      } catch { /* ignore, redirectam oricum */ }

      // Redirecționează imediat la dashboard
      router.push('/client/dashboard');
    } catch (err) {
      setError(err.message || 'A apărut o eroare. Încearcă din nou.');
    } finally {
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

  return (
  <>
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
          <div
            key={step}
            style={{
              flex: 1,
              animation: direction
                ? `${direction === 'forward' ? 'stepFadeSlideIn' : 'stepFadeSlideInBack'} 0.27s ease both`
                : 'none',
            }}
          >

            {/* ── Pasul 1: Date personale ── */}
            {step === 1 && (
              <>
                <h2 className={styles.cardTitle} style={{ marginBottom: 4 }}>Hai să te cunoaștem</h2>
                <p className={styles.cardSub} style={{ marginBottom: 18 }}>Cu cât ești mai sincer, cu atât planul tău e mai precis.</p>

                <div className={styles.formGroup}>
                  <label htmlFor="name">Cum vrei să te numim?</label>
                  <input type="text" id="name"
                    value={form.name} onChange={e => updateForm('name', e.target.value)}
                    placeholder="Numele tău" maxLength="100"
                    style={{ width: '100%', padding: '13px', border: '1.5px solid #e5e5e5', borderRadius: 13, fontSize: 15, background: '#fafafa', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color 0.2s' }}
                    onFocus={e => e.target.style.borderColor = '#7fc800'}
                    onBlur={e => e.target.style.borderColor = '#e5e5e5'} />
                </div>

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
                <h2 className={styles.cardTitle} style={{ marginBottom: 4 }}>Ce vrei să schimbi?</h2>
                <p className={styles.cardSub} style={{ marginBottom: 20 }}>Fără judecată. Fără presiune. Doar direcția ta.</p>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 7, fontSize: 13, fontWeight: 600, color: '#555' }}>Obiectiv principal</label>
                  {GOALS.map(g => (
                    <button key={g.value} type="button" onClick={() => updateForm('goal', g.value)} style={cardToggle(form.goal === g.value)}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: form.goal === g.value ? '#3d5200' : '#222' }}>{g.label}</span>
                      <span style={{ display: 'block', fontSize: 12, color: form.goal === g.value ? '#5a7a00' : '#888', marginTop: 1 }}>{g.desc}</span>
                    </button>
                  ))}
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
                {loading ? 'Se procesează...' : 'Finalizează înscrierea'}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>

    {/* ── Modal XP +50 (fără level up) ── */}
    {xpReward && !levelUpReward && (
      <div className={clientStyles.modalOverlay} onClick={() => { setXpReward(null); router.push('/client/dashboard'); }}>
        <div className={`${clientStyles.confirmModal} ${dashStyles.rewardModal}`} onClick={e => e.stopPropagation()}>
          <div className={dashStyles.rewardIcon}><span>🎉</span></div>
          <div className={dashStyles.rewardXpBadge}>+50 XP</div>
          <h3>Înregistrare finalizată!</h3>
          <p>Bine ai venit! Ai câștigat primii 50 XP pentru că ți-ai completat profilul.</p>
          {xpReward.levelInfo && (
            <div className={dashStyles.rewardLevelLine}>
              Nivel {xpReward.levelInfo.level}
              <span>{xpReward.levelInfo.xpInCurrentLevel} / {xpReward.levelInfo.xpForNextLevel} XP</span>
            </div>
          )}
          <div className={clientStyles.confirmActions}>
            <button
              className={clientStyles.saveBtn}
              style={{ background: '#0a0a0a', color: '#b7ff00', width: '100%' }}
              onClick={() => { setXpReward(null); router.push('/client/dashboard'); }}
            >
              Mergi la dashboard →
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Modal Level Up ── */}
    {levelUpReward && (
      <div className={clientStyles.modalOverlay} onClick={() => { setLevelUpReward(null); router.push('/client/dashboard'); }}>
        <div className={`${clientStyles.confirmModal} ${dashStyles.rewardModal} ${dashStyles.levelUpModal}`} onClick={e => e.stopPropagation()}>
          <div className={dashStyles.rewardIcon}><span>💪</span></div>
          <div className={dashStyles.rewardXpBadge}>LEVEL UP</div>
          <h3>Nivel {levelUpReward.toLevel}</h3>
          <p>Ai trecut de la nivelul {levelUpReward.fromLevel} la nivelul {levelUpReward.toLevel}. Bun început!</p>
          <div className={dashStyles.rewardLevelLine}>
            Nivel {levelUpReward.levelInfo.level}
            <span>{levelUpReward.levelInfo.xpInCurrentLevel} / {levelUpReward.levelInfo.xpForNextLevel} XP</span>
          </div>
          <div className={clientStyles.confirmActions}>
            <button
              className={clientStyles.saveBtn}
              style={{ background: '#0a0a0a', color: '#b7ff00', width: '100%' }}
              onClick={() => { setLevelUpReward(null); router.push('/client/dashboard'); }}
            >
              Mergi la dashboard →
            </button>
          </div>
        </div>
      </div>
    )}
    <style>{`
      @keyframes stepFadeSlideIn {
        from { opacity: 0; transform: translateX(16px); }
        to   { opacity: 1; transform: translateX(0); }
      }
      @keyframes stepFadeSlideInBack {
        from { opacity: 0; transform: translateX(-16px); }
        to   { opacity: 1; transform: translateX(0); }
      }
    `}</style>
  </>
  );
}
