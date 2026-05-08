import Link from 'next/link';
import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.logoMark}>t</span>
          <span className={styles.logoText}>trevano</span>
        </div>
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>Pagina nu există</h1>
        <p className={styles.text}>
          Linkul accesat nu duce către o pagină validă din trevano.
        </p>
        <Link className={styles.button} href="/">
          Înapoi la pagina principală
        </Link>
      </section>
    </main>
  );
}
