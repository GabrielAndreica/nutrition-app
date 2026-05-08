import Link from 'next/link';
import styles from './landing.module.css';
import ScrollReveal from './ScrollReveal';

export const metadata = {
  title: 'trevano — Planuri alimentare și antrenament generate cu AI',
  description: 'Generează planuri alimentare și de antrenament personalizate pentru clienții tăi în 2 minute. Portal client inclus. Ajustări automate bazate pe progres.',
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

function MockupDashboard() {
  return <PhoneMockup src="/screenshots/mockup-dashboard.png" alt="Dashboard antrenor" />;
}

function MockupMealPlan() {
  return <PhoneMockup src="/screenshots/mockup-meal-plan.png" alt="Plan alimentar generat" />;
}

function MockupProgress() {
  return <PhoneMockup src="/screenshots/mockup-progress.png" alt="Vizualizare progres client" />;
}

export default function LandingPage() {
  return (
    <div className={styles.root}>

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
            Planuri personalizate<br /><span className={styles.accent}>generate în 2 minute.</span>
          </h1>
          <p className={styles.heroSub} data-reveal data-delay="2">
            Trevano generează planuri alimentare și de antrenament personalizate pentru clienții tăi — în 2 minute, cu portal client inclus.
          </p>
          <div className={styles.heroActions} data-reveal data-delay="3">
            <Link href="/auth" className={styles.ctaPrimary}>Începe gratuit 14 zile →</Link>
            <span className={styles.heroNote}>Fără card de credit. Anulezi oricând.</span>
          </div>
          <div className={styles.heroStats} data-reveal data-delay="4">
            <div className={styles.heroStat}><span className={styles.heroStatNum}>2 min</span><span className={styles.heroStatLabel}>per plan generat</span></div>
            <div className={styles.heroStatDivider} />
            <div className={styles.heroStat}><span className={styles.heroStatNum}>10h+</span><span className={styles.heroStatLabel}>economisit lunar</span></div>
            <div className={styles.heroStatDivider} />
            <div className={styles.heroStat}><span className={styles.heroStatNum}>100%</span><span className={styles.heroStatLabel}>personalizat</span></div>
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
            <h2 className={styles.featureHeading}>Plan alimentar și de antrenament,<br /><span className={styles.accent}>generate instant.</span></h2>
            <p className={styles.featureDesc}>Un singur click — clientul primește un plan alimentar complet de 7 zile și un plan de antrenament adaptat obiectivului și nivelului său.</p>
            <ul className={styles.featureBullets}>
              <li><span className={styles.bullet}>✓</span> Plan alimentar de 7 zile cu rețete reale</li>
              <li><span className={styles.bullet}>✓</span> Macro-uri și calorii calculate automat</li>
              <li><span className={styles.bullet}>✓</span> Plan de antrenament adaptat nivelului</li>
            </ul>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className={styles.howSection} data-reveal>
        <div className={styles.howInner}>
          <p className={styles.sectionLabel} style={{ textAlign: 'center' }}>Cum funcționează</p>
          <h2 className={styles.sectionTitle} style={{ textAlign: 'center' }}>3 pași până la primul plan</h2>
          <div className={styles.stepsGrid}>
            {[
              { num: '01', title: 'Adaugă clientul', desc: 'Completezi profilul cu date antropometrice, obiectiv, dietă și preferințe. Durează 2 minute.' },
              { num: '02', title: 'Generezi planurile', desc: 'Un click — planul alimentar și de antrenament personalizat sunt gata în câteva secunde.' },
              { num: '03', title: 'Monitorizezi și ajustezi', desc: 'Clientul raportează progresul săptămânal, tu primești notificare și regenerezi planul adaptat.' },
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
            <h2 className={styles.featureHeading}>Cât timp pierzi lunar<br /><span className={styles.accent}>pe planuri manuale?</span></h2>
            <p className={styles.featureDesc}>Antrenorii petrec în medie 1–2 ore per client pe planuri manuale. Cu 10 clienți activi — <strong style={{ color: '#fff' }}>10–20 ore pierdute lunar.</strong></p>
            <Link href="/auth" className={styles.ctaPrimary} style={{ display: 'inline-block', marginTop: '24px' }}>Încearcă gratuit →</Link>
          </div>
          <div className={styles.statsRight}>
            {[
              { num: '1–2h', desc: 'per client, pe planuri manuale' },
              { num: '×10', desc: 'clienți = 10–20h pierdute lunar' },
              { num: '2 min', desc: 'cu Trevano, per plan complet' },
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
                <li><span className={styles.check}>✓</span> Planuri alimentare nelimitate</li>
                <li><span className={styles.check}>✓</span> Planuri antrenament nelimitate</li>
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
          <h2 className={styles.finalTitle}>Gata să economisești <span className={styles.accent}>10+ ore</span> pe lună?</h2>
          <p className={styles.finalSub}>Alătură-te antrenorilor care folosesc Trevano pentru a-și servi mai bine clienții.</p>
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
