'use client';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/app/components/ProtectedRoute';
import styles from './antrenament.module.css';

const SESSIONS = {
  push:      { title: 'Push',       muscles: 'Piept · Umeri · Triceps',                desc: 'Antrenament de împingere — exerciții compound pentru piept, presă pentru umeri și finalizare pe triceps.' },
  pull:      { title: 'Pull',       muscles: 'Spate · Biceps',                          desc: 'Antrenament de tragere — tracțiuni, ramate și pulldown pentru spate, finalizat cu izolație pe biceps.' },
  legs:      { title: 'Legs',       muscles: 'Cvadriceps · Femurali · Fesieri · Gambe', desc: 'Cel mai solicitant antrenament din program. Genuflexiuni, hip thrust, leg press și izolație completă.' },
  upper:     { title: 'Upper Body', muscles: 'Tren Superior Complet',                   desc: 'Sesiune echilibrată pentru piept, spate, umeri și brațe — tot trenul superior într-o singură sesiune.' },
  lower:     { title: 'Lower Body', muscles: 'Tren Inferior Complet',                   desc: 'Picioare, fesieri, gambe și core — sesiune dedicată trenului inferior.' },
  fullBody:  { title: 'Full Body',  muscles: 'Tot Corpul',                              desc: 'Antrenament complet — fiecare grupă musculară lucrată eficient în aceeași sesiune.' },
  chest:     { title: 'Piept',      muscles: 'Mușchi Pectorali',                        desc: 'Zi dedicată pieptului — volum ridicat cu exerciții compound și izolație.' },
  back:      { title: 'Spate',      muscles: 'Latissimus · Rhomboid · Trapez',          desc: 'Zi dedicată spatelui — lățime și densitate, exerciții de tragere variate.' },
  shoulders: { title: 'Umeri',      muscles: 'Deltoid Anterior · Medial · Posterior',   desc: 'Zi dedicată umerilor — presă militară, ridicări laterale și față-pull.' },
  arms:      { title: 'Brațe',      muscles: 'Biceps · Triceps',                        desc: 'Zi dedicată brațelor — volum ridicat pe biceps și triceps pentru pump și hipertrofie maximă.' },
  core:      { title: 'Core',       muscles: 'Abdomen · Stabilizatori',                 desc: 'Zi dedicată core-ului — planșă, dead bug și exerciții de stabilitate și forță abdominală.' },
};

function AntrenamentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focus = searchParams.get('focus') || 'fullBody';
  const session = SESSIONS[focus] || SESSIONS.fullBody;

  const handleStart = () => {
    try { localStorage.setItem('openWorkoutTab', '1'); } catch {}
    router.push('/client/dashboard');
  };

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => router.back()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Înapoi
      </button>

      <div className={styles.card}>
        <span className={styles.badge}>Azi 💪</span>
        <h1 className={styles.title}>{session.title}</h1>
        <p className={styles.muscles}>{session.muscles}</p>
        <p className={styles.desc}>{session.desc}</p>
        <button className={styles.startBtn} onClick={handleStart}>
          Start →
        </button>
      </div>
    </div>
  );
}

export default function AntrenamentPage() {
  return (
    <ProtectedRoute>
      <Suspense fallback={null}>
        <AntrenamentContent />
      </Suspense>
    </ProtectedRoute>
  );
}
