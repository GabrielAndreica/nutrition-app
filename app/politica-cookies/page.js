import LegalPage from '@/app/components/LegalPage';

export const metadata = {
  title: 'Politica Cookies',
  description: 'Ce cookies folosește Trevano și cum sunt folosite în aplicație.',
  alternates: {
    canonical: '/politica-cookies',
  },
};

export default function CookiesPage() {
  return (
    <LegalPage
      eyebrow="Cookies"
      title="POLITICĂ COOKIES"
      meta={[
        'Trevano (trevano.app)',
        'Ultima actualizare: 07.05.2026',
      ]}
      sections={[
        {
          title: '1. Ce sunt cookies',
          body: [
            'Cookies sunt fișiere text mici stocate pe dispozitivul tău atunci când vizitezi un website. Sunt folosite pentru a face site-urile să funcționeze corect și pentru a oferi informații proprietarilor.',
          ],
        },
        {
          title: '2. Ce cookies folosim',
          body: [
            '2.1. Cookies strict necesare',
            'Aceste cookies sunt esențiale pentru funcționarea aplicației și nu pot fi dezactivate:',
          ],
          items: [
            'Cookie sesiune autentificare — păstrează starea de autentificare între pagini. Durata: sesiune (se șterge la închiderea browserului) sau 30 de zile dacă alegi "Ține-mă minte"',
            'Cookie preferințe UI — stochează preferințele de interfață. Durata: 1 an',
          ],
          after: [
            'Aceste cookies nu necesită consimțământul tău deoarece sunt strict necesare pentru furnizarea serviciului solicitat.',
            '2.2. Cookies terță parte — Stripe',
            'Stripe, procesatorul nostru de plăți, poate plasa cookies pentru prevenirea fraudelor în momentul efectuării plăților. Aceste cookies sunt guvernate de politica de confidențialitate Stripe (stripe.com/privacy).',
            '2.3. Cookies de tracking sau marketing',
            'Nu folosim cookies de tracking, analytics sau marketing. Nu instalăm Google Analytics, Facebook Pixel sau instrumente similare.',
          ],
        },
        {
          title: '3. Cum poți controla cookies',
          body: ['Poți controla și șterge cookies prin setările browserului tău:'],
          items: [
            'Chrome: Setări → Confidențialitate și securitate → Cookie-uri și alte date ale site-urilor',
            'Firefox: Opțiuni → Confidențialitate și securitate → Cookie-uri și date ale site-ului',
            'Safari: Preferințe → Confidențialitate',
            'Edge: Setări → Cookie-uri și permisiuni pentru site',
          ],
          after: [
            'Atenție: dezactivarea cookies strict necesare poate afecta funcționarea aplicației Trevano.',
          ],
        },
        {
          title: '4. Modificări ale politicii de cookies',
          body: [
            'Putem actualiza această politică periodic. Data ultimei actualizări este afișată în antetul documentului.',
          ],
        },
        {
          title: '5. Contact',
          body: [
            'ANDREICA GABRIEL-Ioan PFA',
            'CUI: 46589606',
            'Adresa: Șișești, nr. 247, România',
            'Email: contact@trevano.app',
            'Website: trevano.app',
          ],
        },
      ]}
    />
  );
}
