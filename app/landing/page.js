import Link from 'next/link';
import CookieSettingsButton from '@/app/components/CookieSettingsButton';
import { getSupabase } from '@/app/lib/supabase';
import styles from './landing.module.css';
import ScrollReveal from './ScrollReveal';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Planul pe care îl poți urma',
  description: 'Trevano îți spune ce să mănânci, cum să te antrenezi și îți adaptează planul pe măsură ce progresezi.',
  alternates: {
    canonical: '/',
  },
};

const problemItems = [
  'Nu stii ce exercitii sa faci.',
  'Nu stii cat sa mananci.',
  'Incepi motivat, dar renunti dupa cateva saptamani.',
  'Nu stii daca faci progres sau pierzi timpul.',
];

const solutionSteps = [
  'Iti alegi obiectivul.',
  'Primesti planul personalizat de antrenament si alimentatie.',
  'Urmezi misiunile zilnice.',
  'In fiecare saptamana iti urmaresti progresul.',
  'Daca este nevoie, Trevano iti adapteaza planul.',
];

const howItWorks = [
  {
    icon: 'target',
    title: 'Stabileste obiectivul',
    text: 'Introdu greutatea actuala si greutatea pe care vrei sa o atingi.',
  },
  {
    icon: 'plan',
    title: 'Urmeaza planul',
    text: 'Primesti exercitiile si mesele pentru fiecare zi. Fara ghicit. Fara planuri complicate.',
  },
  {
    icon: 'progress',
    title: 'Urmareste progresul',
    text: 'In fiecare saptamana vezi exact cum evoluezi si daca te apropii de obiectiv.',
  },
  {
    icon: 'coach',
    title: 'Trevano Coach',
    text: 'Daca progresul incetineste, Trevano ajusteaza automat planul pentru directia potrivita.',
  },
];

const todayItems = [
  'Nu stii ce sa faci la sala.',
  'Nu ai un plan alimentar.',
  'Nu esti consecvent.',
  'Nu vezi rezultate.',
];

const futureItems = [
  'Ai o rutina.',
  'Mananci fara sa te intrebi daca faci bine.',
  'Te simti mai puternic.',
  'Esti mult mai aproape de obiectivul tau.',
];

const coachChanges = [
  'ajusteaza aportul caloric',
  'modifica mesele',
  'adapteaza antrenamentele',
  'te mentine pe drumul catre obiectiv',
];

const LANDING_IMAGE_BUCKET = 'imagini-landing';
const LANDING_IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://trevano.app').replace(/\/+$/, '');
const landingImageUrlCache = new Map();

function ProblemIcon() {
  return <span className={styles.problemIcon}>!</span>;
}

function HowFeatureIcon({ type }) {
  const iconProps = {
    width: 23,
    height: 23,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  if (type === 'plan') {
    return (
      <svg {...iconProps}>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h10" />
      </svg>
    );
  }

  if (type === 'progress') {
    return (
      <svg {...iconProps}>
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    );
  }

  if (type === 'coach') {
    return (
      <svg {...iconProps}>
        <path d="M12 2v4" />
        <path d="M12 18v4" />
        <path d="m4.93 4.93 2.83 2.83" />
        <path d="m16.24 16.24 2.83 2.83" />
        <path d="M2 12h4" />
        <path d="M18 12h4" />
        <path d="m4.93 19.07 2.83-2.83" />
        <path d="m16.24 7.76 2.83-2.83" />
      </svg>
    );
  }

  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
    </svg>
  );
}

function encodeStoragePath(path = '') {
  return String(path)
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function buildLandingImageUrl(path, { width = 980, height = 552, quality = 78 } = {}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return '';

  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    resize: 'cover',
    quality: String(quality),
  });

  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/render/image/public/${encodeURIComponent(LANDING_IMAGE_BUCKET)}/${encodeStoragePath(path)}?${params.toString()}`;
}

function getLandingImageCandidates(path) {
  const cleanPath = String(path || '').trim();
  if (!cleanPath) return [];
  if (/\.[a-z0-9]+$/i.test(cleanPath)) return [cleanPath];

  return [`${cleanPath}.png`, `${cleanPath}.jpg`, `${cleanPath}.jpeg`, `${cleanPath}.webp`, cleanPath];
}

async function resolveLandingImageUrl(path, options) {
  const candidates = getLandingImageCandidates(path);
  const cacheKey = `${candidates[0] || path}:${options?.width || ''}:${options?.height || ''}:${options?.quality || ''}`;
  const cached = landingImageUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  try {
    const supabase = getSupabase();
    for (const candidate of candidates) {
      const { data, error } = await supabase.storage
        .from(LANDING_IMAGE_BUCKET)
        .createSignedUrl(candidate, LANDING_IMAGE_SIGNED_URL_TTL_SECONDS, {
          transform: {
            width: options?.width || 980,
            height: options?.height || 552,
            resize: 'cover',
            quality: options?.quality || 78,
          },
        });
      if (!error && data?.signedUrl) {
        landingImageUrlCache.set(cacheKey, {
          url: data.signedUrl,
          expiresAt: Date.now() + (LANDING_IMAGE_SIGNED_URL_TTL_SECONDS - 300) * 1000,
        });
        return data.signedUrl;
      }
    }
  } catch (error) {
    console.error('[landing] image signed URL error:', error);
  }

  return buildLandingImageUrl(candidates[0] || path, options);
}

async function HeroImages() {
  const femaleImage = await resolveLandingImageUrl('female-before-after.png', { width: 980, height: 552, quality: 78 });
  const maleImage = await resolveLandingImageUrl('male-before-after.png', { width: 980, height: 552, quality: 78 });

  if (!femaleImage || !maleImage) return null;

  return (
    <div className={styles.heroImages} aria-label="Rezultate posibile cu un plan urmat consecvent">
      <figure className={styles.heroImageCard}>
        {/* Signed Supabase URL keeps the private landing bucket accessible without exposing keys. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={femaleImage}
          alt="Transformare femeie înainte și după"
          width="980"
          height="552"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
      </figure>
      <figure className={`${styles.heroImageCard} ${styles.heroImageCardOffset}`}>
        {/* Signed Supabase URL keeps the private landing bucket accessible without exposing keys. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={maleImage}
          alt="Transformare bărbat înainte și după"
          width="980"
          height="552"
          loading="eager"
          decoding="async"
        />
      </figure>
    </div>
  );
}

async function LandingSectionImage({ path, alt, className }) {
  const imageUrl = await resolveLandingImageUrl(path, { width: 900, height: 394, quality: 76 });
  if (!imageUrl) return null;

  return (
    <figure className={className}>
      {/* Signed Supabase URL keeps the private landing bucket accessible without exposing keys. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={alt} width="900" height="394" loading="lazy" decoding="async" />
    </figure>
  );
}

export default async function LandingPage() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: 'Trevano',
        url: SITE_URL,
        logo: `${SITE_URL}/logo-verde-transparent.svg`,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: 'Trevano',
        url: SITE_URL,
        inLanguage: 'ro-RO',
        publisher: {
          '@id': `${SITE_URL}/#organization`,
        },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_URL}/#software`,
        name: 'Trevano',
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Web',
        url: SITE_URL,
        description: 'Trevano iti spune ce sa mananci, cum sa te antrenezi si iti adapteaza planul pe masura ce progresezi.',
        publisher: {
          '@id': `${SITE_URL}/#organization`,
        },
        audience: {
          '@type': 'Audience',
          audienceType: 'Persoane care vor sa slabeasca, sa ia in greutate sau sa inceapa sala',
        },
        offers: [
          { '@type': 'Offer', name: 'Gratuit', price: '0', priceCurrency: 'RON', url: `${SITE_URL}/auth` },
          { '@type': 'Offer', name: 'Trevano Coach', price: '29.99', priceCurrency: 'RON', url: `${SITE_URL}/upgrade` },
        ],
      },
    ],
  };

  return (
    <div className={styles.root}>
      <div className={`${styles.neonSpot} ${styles.neonSpotOne}`} />
      <div className={`${styles.neonSpot} ${styles.neonSpotTwo}`} />
      <div className={`${styles.neonSpot} ${styles.neonSpotThree}`} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <ScrollReveal />

      <nav className={styles.nav}>
        <Link href="/" className={styles.logo}>trevano</Link>
        <div className={styles.navLinks}>
          <Link href="/auth" className={styles.navLogin}>Intră în cont</Link>
          <Link href="/auth" className={styles.navCta}>Începe gratuit</Link>
        </div>
      </nav>

      <main>
        <section className={styles.heroBand}>
          <div className={styles.hero}>
            <div className={styles.heroText} data-reveal>
              <h1>Corpul pe care îl dorești începe cu un plan pe care îl poți urma.</h1>
              <p>
                Trevano îți spune ce să mănânci, cum să te antrenezi și îți adaptează planul
                pe măsură ce progresezi, până îți atingi obiectivul.
              </p>
              <div className={styles.heroActions}>
                <Link href="/auth" className={styles.primaryCta}>Începe gratuit</Link>
              </div>
            </div>
            <div className={styles.heroVisual} data-reveal data-delay="1">
              <HeroImages />
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.problemSection}`} data-reveal>
          <div className={styles.sectionHeader}>
            <h2>Ai un obiectiv. Dar nu știi de unde să începi.</h2>
          </div>
          <div className={styles.problemGrid}>
            {problemItems.map(item => (
              <div key={item} className={styles.problemItem}>
                <ProblemIcon />
                <p>{item}</p>
              </div>
            ))}
          </div>
          <p className={styles.sectionStatement}>
            Nu ai nevoie de mai multă motivație. Ai nevoie de un plan și de consecvență.
          </p>
        </section>

        <section className={`${styles.section} ${styles.solutionSection}`} data-reveal>
          <div className={styles.sectionHeader}>
            <h2>Trevano te ghidează până îți atingi obiectivul.</h2>
          </div>
          <div className={styles.solutionBody}>
            <div className={styles.stepsList}>
              {solutionSteps.map((step, index) => (
                <div key={step} className={styles.stepNode}>
                  <span>{index + 1}</span>
                  <p>{step}</p>
                </div>
              ))}
            </div>
            <LandingSectionImage
              path="workout-male"
              alt="Antrenament masculin ghidat de Trevano"
              className={styles.solutionImage}
            />
          </div>
        </section>

        <section className={`${styles.section} ${styles.howSection}`} data-reveal>
          <div className={styles.sectionHeader}>
            <h2>Totul e gândit pentru pași simpli, repetați zilnic.</h2>
          </div>
          <div className={styles.howGrid}>
            {howItWorks.map(item => (
              <article key={item.title} className={styles.howCard}>
                <div className={styles.howIcon}>
                  <HowFeatureIcon type={item.icon} />
                </div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.futureSection} data-reveal>
          <div className={styles.sectionHeader}>
            <h2>De la confuzie la rutină clară.</h2>
          </div>
          <div className={styles.futureBody}>
            <div className={styles.beforeAfter}>
              <div className={styles.timelineCard}>
                <h3>Astăzi</h3>
                {todayItems.map(item => (
                  <p key={item}><span className={styles.badMark}>×</span>{item}</p>
                ))}
              </div>
              <div className={`${styles.timelineCard} ${styles.timelineCardGood}`}>
                <h3>Peste 12 săptămâni</h3>
                {futureItems.map(item => (
                  <p key={item}><span className={styles.goodMark}>✓</span>{item}</p>
                ))}
              </div>
            </div>
            <LandingSectionImage
              path="workout-female"
              alt="Antrenament feminin cu rutină clară"
              className={styles.futureImage}
            />
          </div>
        </section>

        <section className={styles.coachSection} data-reveal>
          <div className={styles.coachText}>
            <h2>Nu mai trebuie să ghicești ce trebuie schimbat.</h2>
            <p>
              În fiecare săptămână, Trevano analizează progresul tău. Dacă este nevoie,
              ajustează planul ca să continui în direcția obiectivului.
            </p>
            <Link href="/auth" className={styles.coachCta}>Începe gratuit</Link>
          </div>
          <div className={styles.coachList}>
            {coachChanges.map(item => (
              <div key={item}>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span className={styles.footerLogo}>trevano.app</span>
        <p>© 2026 Trevano. Toate drepturile rezervate.</p>
        <div className={styles.footerLinks}>
          <Link href="/termeni-si-conditii">Termeni și condiții</Link>
          <Link href="/politica-de-confidentialitate">Politica de confidențialitate</Link>
          <Link href="/politica-cookies">Politica Cookies</Link>
          <CookieSettingsButton className={styles.footerButtonLink} />
          <a href="https://anpc.ro/" target="_blank" rel="noopener noreferrer">ANPC</a>
          <a href="https://reclamatiisal.anpc.ro/" target="_blank" rel="noopener noreferrer">ANPC SAL</a>
          <Link href="/auth">Autentificare</Link>
        </div>
      </footer>
    </div>
  );
}
