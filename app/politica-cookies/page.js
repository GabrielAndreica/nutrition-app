import LegalPage from '@/app/components/LegalPage';

export const metadata = {
  title: 'Politica Cookies | trevano',
};

export default function CookiesPage() {
  return (
    <LegalPage
      eyebrow="Cookies"
      title="Politica Cookies"
      intro="trevano folosește cookie-uri și tehnologii similare pentru autentificare, securitate și funcționarea aplicației."
      sections={[
        {
          title: 'Cookie-uri necesare',
          body: [
            'Aceste cookie-uri păstrează sesiunea de autentificare și permit accesul la zonele protejate ale aplicației.',
          ],
        },
        {
          title: 'Stocare locală',
          body: [
            'Aplicația poate folosi localStorage sau sessionStorage pentru date temporare precum tokenul de autentificare, preferințe de interfață sau stări de navigare.',
          ],
        },
        {
          title: 'Administrare',
          body: [
            'Poți șterge cookie-urile din browser. Unele funcții ale aplicației pot să nu mai funcționeze corect fără cookie-urile necesare.',
          ],
        },
      ]}
    />
  );
}
