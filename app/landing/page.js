import Link from 'next/link';
import styles from './landing.module.css';
import ScrollReveal from './ScrollReveal';

export const metadata = {
  title: 'Trevano — Aplicație pentru antrenori de fitness',
  description: 'Trevano este aplicația pentru antrenori de fitness unde ții clienții, planurile alimentare, antrenamentele și progresul într-un singur loc.',
  alternates: {
    canonical: '/',
  },
};

/* ── Phone mockup helper ── */
function PhoneMockup({ src, alt }) {
  return (
    <div className={styles.phoneFrame}>
      <div className={styles.phoneInner}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={styles.phoneScreenImg} />
      </div>
    </div>
  );
}

function MockupMealPlan() {
  return <PhoneMockup src="/screenshots/mockup-meal-plan.png" alt="Plan alimentar generat" />;
}

export default function LandingPage() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://trevano.app/#organization',
        name: 'Trevano',
        url: 'https://trevano.app',
        logo: 'https://trevano.app/logo-verde-transparent.svg',
      },
      {
        '@type': 'WebSite',
        '@id': 'https://trevano.app/#website',
        name: 'Trevano',
        url: 'https://trevano.app',
        inLanguage: 'ro-RO',
        publisher: {
          '@id': 'https://trevano.app/#organization',
        },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': 'https://trevano.app/#software',
        name: 'Trevano',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: 'https://trevano.app',
        image: 'https://trevano.app/screenshots/mockup-meal-plan.png',
        description: 'Trevano este aplicația pentru antrenori de fitness unde ții clienții, planurile alimentare, antrenamentele și progresul într-un singur loc.',
        publisher: {
          '@id': 'https://trevano.app/#organization',
        },
        audience: {
          '@type': 'Audience',
          audienceType: 'Antrenori de fitness',
        },
        offers: [
          { '@type': 'Offer', name: 'Starter', price: '149', priceCurrency: 'RON', url: 'https://trevano.app' },
          { '@type': 'Offer', name: 'Pro', price: '249', priceCurrency: 'RON', url: 'https://trevano.app' },
        ],
      },
    ],
  };

  return (
    <div className={styles.root}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/* NAV */}
      <nav className={styles.nav}>
        <span className={styles.logo}>trevano</span>
        <div className={styles.navLinks}>
          <Link href="/auth" className={styles.navLogin}>Intră în cont</Link>
          <Link href="/auth" className={styles.navCta}>Începe gratuit</Link>
        </div>
      </nav>

      <ScrollReveal />

      {/* HERO */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroLeft}>
          <div className={styles.heroBadge} data-reveal data-delay="0">Pentru antrenori personali</div>
          <h1 className={styles.heroHeadline} data-reveal data-delay="1">
            Aplicația pentru antrenori de fitness<br /><span className={styles.accent}>care vor ordine.</span>
          </h1>
          <p className={styles.heroSub} data-reveal data-delay="2">
            Trevano te ajută să ții clienții, planurile alimentare, antrenamentele și progresul într-un singur loc. Fără ChatGPT, Word, tabele și multe tab-uri deschise.
          </p>
          <div className={styles.heroActions} data-reveal data-delay="3">
            <Link href="/auth" className={styles.ctaPrimary}>Începe gratuit 14 zile →</Link>
            <span className={styles.heroNote}>Fără card de credit. Anulezi oricând.</span>
          </div>
          <div className={styles.heroStats} data-reveal data-delay="4">
            <div className={styles.heroStat}><span className={styles.heroStatNum}>1 loc</span><span className={styles.heroStatLabel}>pentru clienți și planuri</span></div>
            <div className={styles.heroStatDivider} />
            <div className={styles.heroStat}><span className={styles.heroStatNum}>10h+</span><span className={styles.heroStatLabel}>economisit lunar</span></div>
            <div className={styles.heroStatDivider} />
            <div className={styles.heroStat}><span className={styles.heroStatNum}>0</span><span className={styles.heroStatLabel}>fișiere pierdute</span></div>
          </div>
        </div>
        <div className={styles.heroRight}>
          <div className={styles.heroMesh}>
            <div className={styles.meshOrb1} />
            <div className={styles.meshOrb2} />
            <div className={styles.meshOrb3} />
            <div className={styles.meshGrid} />
          </div>
        </div>
      </section>

      {/* FEATURE 1 */}
      <section className={styles.featureSection} data-reveal>
        <div className={styles.featureSectionInner}>
          <div className={styles.featureMockup}><MockupMealPlan /></div>
          <div className={styles.featureText}>
            <p className={styles.sectionLabel}>Planuri complete</p>
            <h2 className={styles.featureHeading}>Plan alimentar și antrenament,<br /><span className={styles.accent}>fără să sari între aplicații.</span></h2>
            <p className={styles.featureDesc}>Adaugi clientul, creezi planurile, le verifici, ajustezi gramaje sau serii și abia apoi le trimiți în portalul clientului.</p>
            <ul className={styles.featureBullets}>
              <li><span className={styles.bullet}>✓</span> Plan alimentar de 7 zile cu rețete reale</li>
              <li><span className={styles.bullet}>✓</span> Macro-uri, calorii și gramaje într-o pagină clară</li>
              <li><span className={styles.bullet}>✓</span> Plan de antrenament adaptat nivelului</li>
            </ul>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className={styles.howSection} data-reveal>
        <div className={styles.howInner}>
          <p className={styles.sectionLabel} style={{ textAlign: 'center' }}>Cum funcționează</p>
          <h2 className={styles.sectionTitle} style={{ textAlign: 'center' }}>3 pași simpli</h2>
          <div className={styles.stepsGrid}>
            {[
              { num: '01', title: 'Adaugi clientul', desc: 'Profil, obiectiv, preferințe alimentare și date de antrenament într-o singură fișă.' },
              { num: '02', title: 'Verifici planurile', desc: 'Plan alimentar și antrenament în pagini clare, cu ajustări directe pentru gramaje și serii.' },
              { num: '03', title: 'Urmărești progresul', desc: 'Progresul clientului ajunge în același sistem, iar tu decizi dacă păstrezi sau actualizezi planul.' },
            ].map(({ num, title, desc }) => (
              <div key={num} className={styles.stepCard}>
                <div className={styles.stepNum}>{num}</div>
                <h3 className={styles.stepTitle}>{title}</h3>
                <p className={styles.stepDesc}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className={styles.statsSection} data-reveal>
        <div className={styles.statsInner}>
          <div className={styles.statsLeft}>
            <p className={styles.sectionLabel}>De ce Trevano</p>
            <h2 className={styles.featureHeading}>Cât timp pierzi lunar<br /><span className={styles.accent}>cu lucruri puse peste tot?</span></h2>
            <p className={styles.featureDesc}>Când lucrezi cu ChatGPT, documente, tabele și PDF-uri separate, devine greu să urmărești fiecare client. Trevano pune lucrurile importante într-un singur loc.</p>
            <Link href="/auth" className={styles.ctaPrimary} style={{ display: 'inline-block', marginTop: '24px' }}>Încearcă gratuit →</Link>
          </div>
          <div className={styles.statsRight}>
            {[
              { num: '1–2h', desc: 'per client, pe planuri făcute manual' },
              { num: '×10', desc: 'clienți = 10–20h pierdute lunar' },
              { num: '2 min', desc: 'pentru un plan complet în Trevano' },
            ].map(({ num, desc }) => (
              <div key={num} className={styles.statCard}>
                <span className={styles.statNum}>{num}</span>
                <span className={styles.statDesc}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className={styles.pricingSection} data-reveal>
        <div className={styles.pricingInner}>
          <p className={styles.sectionLabel} style={{ textAlign: 'center' }}>Prețuri</p>
          <h2 className={styles.sectionTitle} style={{ textAlign: 'center' }}>Simplu. Transparent. Fără surprize.</h2>
          <div className={styles.pricingGrid}>
            <div className={styles.pricingCard}>
              <h3 className={styles.planName}>Starter</h3>
              <div className={styles.planPrice}><span className={styles.planAmount}>149 RON</span><span className={styles.planPeriod}>/ lună</span></div>
              <ul className={styles.planFeatures}>
                <li><span className={styles.check}>✓</span> Până la 10 clienți activi</li>
                <li><span className={styles.check}>✓</span> Planuri alimentare pe fiecare client</li>
                <li><span className={styles.check}>✓</span> Planuri de antrenament pe fiecare client</li>
                <li><span className={styles.check}>✓</span> Portal clienți</li>
                <li><span className={styles.check}>✓</span> Monitorizare progres clienți</li>
              </ul>
              <Link href="/auth" className={styles.planCta}>Începe gratuit 14 zile</Link>
            </div>
            <div className={`${styles.pricingCard} ${styles.pricingCardPro}`}>
              <div className={styles.proBadge}>Popular</div>
              <h3 className={styles.planName}>Pro</h3>
              <div className={styles.planPrice}><span className={styles.planAmount}>249 RON</span><span className={styles.planPeriod}>/ lună</span></div>
              <ul className={styles.planFeatures}>
                <li><span className={styles.checkAccent}>✓</span> Până la 30 clienți activi</li>
                <li><span className={styles.checkAccent}>✓</span> Tot ce e în Starter</li>
                <li><span className={styles.checkAccent}>✓</span> Suport prioritar</li>
              </ul>
              <Link href="/auth" className={styles.planCtaAccent}>Începe gratuit 14 zile →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className={styles.finalCta} data-reveal>
        <div className={styles.finalGlow} />
        <div className={styles.finalCtaInner}>
          <h2 className={styles.finalTitle}>Gata să pui <span className={styles.accent}>totul</span> în ordine?</h2>
          <p className={styles.finalSub}>Trevano este pentru antrenorii care vor clienți, planuri și progres într-un singur loc.</p>
          <Link href="/auth" className={styles.ctaPrimary}>Începe 14 zile gratuit →</Link>
          <p className={styles.heroNote}>Fără card de credit. Anulezi oricând.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className={styles.footer}>
        <span className={styles.logo}>trevano.app</span>
        <p className={styles.footerText}>© 2026 Trevano. Toate drepturile rezervate.</p>
        <div className={styles.footerLinks}>
          <Link href="/termeni-si-conditii" className={styles.footerLink}>Termeni și condiții</Link>
          <Link href="/politica-de-confidentialitate" className={styles.footerLink}>Politica de confidențialitate</Link>
          <Link href="/politica-cookies" className={styles.footerLink}>Politica Cookies</Link>
          <Link href="/auth" className={styles.footerLink}>Autentificare</Link>
        </div>
      </footer>

    </div>
  );
}
