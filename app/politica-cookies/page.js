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
      title="POLITICĂ PRIVIND COOKIE-URILE"
      meta={[
        'Ultima actualizare: 19.07.2026',
      ]}
      sections={[
        {
          title: '1. Ce sunt cookie-urile?',
          body: [
            'Cookie-urile sunt fișiere text de mici dimensiuni stocate pe dispozitivul tău atunci când vizitezi un website.',
            'Acestea permit funcționarea corectă a website-ului, rețin anumite preferințe și, în funcție de consimțământul tău, ne ajută să analizăm utilizarea serviciului și eficiența campaniilor publicitare.',
          ],
        },
        {
          title: '2. Ce tipuri de cookie-uri folosim?',
          body: [
            '2.1. Cookie-uri strict necesare',
            'Aceste cookie-uri sunt esențiale pentru funcționarea website-ului și a aplicației Trevano și nu pot fi dezactivate.',
            'Acestea pot include:',
          ],
          items: [
            'cookie-uri de autentificare;',
            'cookie-uri pentru menținerea sesiunii;',
            'cookie-uri necesare funcționării contului;',
            'cookie-uri care rețin preferințele privind consimțământul pentru cookie-uri;',
            'cookie-uri necesare securității aplicației.',
          ],
          after: [
            'Aceste cookie-uri sunt utilizate exclusiv pentru furnizarea serviciului solicitat și nu necesită consimțământul utilizatorului.',
            '2.2. Cookie-uri de performanță și analiză',
            'Cu acordul tău putem utiliza tehnologii care ne ajută să înțelegem modul în care este utilizat website-ul și să îmbunătățim experiența utilizatorilor.',
            'Aceste cookie-uri pot colecta informații precum: paginile vizitate; durata sesiunii; sursa traficului; interacțiunile generale cu website-ul; tipul dispozitivului și browserului utilizat.',
            'Aceste informații sunt utilizate exclusiv în scop statistic și pentru îmbunătățirea serviciului.',
            '2.3. Cookie-uri de marketing',
            'Dacă îți exprimi consimțământul, putem utiliza servicii precum Meta Pixel și TikTok Pixel.',
            'Aceste tehnologii ne ajută să măsurăm eficiența campaniilor publicitare, să înțelegem modul în care utilizatorii ajung pe website, să optimizăm reclamele afișate și să creăm audiențe relevante pentru campaniile viitoare.',
            'Aceste servicii pot prelucra informații precum: adresa IP; browserul utilizat; identificatori ai dispozitivului; URL-urile vizitate; informații privind reclamele accesate; timestamp-ul vizitei; interacțiunile generale cu website-ul.',
            'Nu transmitem către aceste servicii date privind planurile personalizate, obiectivele, progresul, greutatea, recomandările generate sau alte informații introduse în aplicația Trevano.',
            'Cookie-urile de marketing sunt activate numai după acordul tău explicit.',
            '2.4. Cookie-uri ale furnizorilor de plăți',
            'În cazul efectuării unei plăți, procesatorul de plăți utilizat de Trevano poate utiliza propriile cookie-uri pentru procesarea tranzacțiilor, prevenirea fraudelor și securizarea plăților.',
            'Aceste cookie-uri sunt administrate exclusiv de furnizorul serviciului de plată și sunt guvernate de propria sa politică de confidențialitate.',
          ],
        },
        {
          title: '3. Cum îți poți gestiona consimțământul?',
          body: [
            'La prima vizită pe website îți este afișat un banner prin care poți:',
          ],
          items: [
            'accepta toate cookie-urile;',
            'respinge cookie-urile opționale;',
            'personaliza preferințele.',
          ],
          after: [
            'Îți poți modifica alegerea în orice moment din secțiunea „Setări cookie-uri” disponibilă pe website.',
          ],
        },
        {
          title: '4. Gestionarea cookie-urilor din browser',
          body: [
            'Majoritatea browserelor permit controlul cookie-urilor.',
            'Poți modifica setările direct din browserul utilizat.',
            'Dezactivarea cookie-urilor strict necesare poate afecta funcționarea corectă a website-ului și a aplicației.',
          ],
        },
        {
          title: '5. Furnizori terți',
          body: [
            'În funcție de consimțământul acordat, website-ul poate utiliza servicii oferite de:',
          ],
          items: [
            'Stripe – procesarea plăților;',
            'Meta Platforms Ireland Limited;',
            'TikTok Technology Limited.',
          ],
          after: [
            'Fiecare dintre acești furnizori își prelucrează propriile date conform politicilor lor de confidențialitate.',
          ],
        },
        {
          title: '6. Modificarea politicii privind cookie-urile',
          body: [
            'Putem actualiza periodic această Politică privind Cookie-urile pentru a reflecta modificările legislative sau schimbările aduse serviciilor Trevano.',
            'Versiunea actualizată va fi publicată pe website și va produce efecte de la data publicării.',
          ],
        },
        {
          title: '7. Contact',
          body: [
            'Operator:',
            'ANDREICA GABRIEL-Ioan PFA',
            'CUI: 46589606',
            'Website: https://trevano.app',
            'Email: contact@trevano.app',
          ],
        },
      ]}
    />
  );
}
