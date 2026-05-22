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
        'Ultima actualizare: 22.05.2026',
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
            'Preferința de consimțământ cookies — păstrează alegerea ta privind cookie-urile opționale. Durata: până la schimbarea preferinței sau ștergerea datelor din browser',
          ],
          after: [
            'Aceste cookies nu necesită consimțământul tău deoarece sunt strict necesare pentru furnizarea serviciului solicitat.',
            '2.2. Cookies terță parte — Stripe',
            'Stripe, procesatorul nostru de plăți, poate plasa cookies pentru prevenirea fraudelor în momentul efectuării plăților. Aceste cookies sunt guvernate de politica de confidențialitate Stripe (stripe.com/privacy).',
            '2.3. Cookies de marketing și analytics',
            'Dacă alegi "Acceptă toate", putem activa TikTok Pixel și Meta Pixel pe paginile publice Trevano pentru măsurarea traficului venit din reclame, atribuirea campaniilor și optimizarea audiențelor publicitare.',
            'Acești furnizori pot prelucra informații tehnice precum URL-ul vizitat, referrer-ul, identificatori de click/reclamă, timestamp, adresa IP, user agent, cookie-uri sau identificatori similari și interacțiuni generale cu pagina. Nu trimitem către acești pixeli date despre planuri alimentare, planuri de antrenament sau datele clienților din aplicație.',
            'Pixelii de marketing sunt încărcați doar după consimțământul tău explicit și nu sunt încărcați pe rutele protejate ale aplicației.',
          ],
        },
        {
          title: '3. Cum poți controla cookies',
          body: [
            'Poți accepta sau respinge cookie-urile opționale din bannerul afișat la prima vizită. Îți poți modifica alegerea oricând din linkul "Setări cookies" din footer.',
            'Poți controla și șterge cookies și prin setările browserului tău:',
          ],
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
