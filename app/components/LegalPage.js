import Link from 'next/link';
import CookieSettingsButton from '@/app/components/CookieSettingsButton';
import styles from '@/app/legal.module.css';

export default function LegalPage({ eyebrow, title, meta = [], intro, sections }) {
  const introLines = Array.isArray(intro) ? intro : intro ? [intro] : [];

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.logo}>trevano</Link>
        <Link href="/" className={styles.backLink}>Înapoi la pagina principală</Link>
      </nav>
      <main className={styles.main}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        {meta.length > 0 && (
          <div className={styles.meta}>
            {meta.map((line) => <p key={line}>{line}</p>)}
          </div>
        )}
        {introLines.map((line) => <p key={line} className={styles.intro}>{line}</p>)}
        {sections.map((section) => (
          <section key={section.title} className={styles.section}>
            <h2>{section.title}</h2>
            {section.body?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items && (
              <ul>
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
            {section.after?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
        <footer className={styles.footer}>
          <Link href="/termeni-si-conditii">Termeni și condiții</Link>
          <Link href="/politica-de-confidentialitate">Politica de confidențialitate</Link>
          <Link href="/politica-cookies">Politica Cookies</Link>
          <CookieSettingsButton className={styles.cookieSettingsButton} />
        </footer>
      </main>
    </div>
  );
}
