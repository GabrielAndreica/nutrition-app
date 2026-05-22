import LegalPage from '@/app/components/LegalPage';

export const metadata = {
  title: 'Politica de confidențialitate',
  description: 'Cum protejează Trevano datele antrenorilor de fitness și ale clienților lor.',
  alternates: {
    canonical: '/politica-de-confidentialitate',
  },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Confidențialitate"
      title="POLITICĂ DE CONFIDENȚIALITATE"
      meta={[
        'Trevano (trevano.app)',
        'Ultima actualizare: 22.05.2026',
      ]}
      sections={[
        {
          title: '1. Identitatea operatorului de date',
          body: [
            'Serviciul Trevano este operat de ANDREICA GABRIEL-Ioan PFA, cu sediul în Șișești, nr. 247, România, CUI 46589606.',
            'Email de contact: contact@trevano.app',
            'Website: trevano.app',
          ],
        },
        {
          title: '2. Ce date colectăm',
          body: [
            '2.1. Date furnizate direct de utilizator',
          ],
          items: [
            'Nume și prenume',
            'Adresă de email',
            'Număr de telefon (opțional)',
            'Parolă (stocată criptat cu bcrypt)',
            'Date de plată (procesate exclusiv de Stripe — nu stocăm carduri)',
          ],
          after: [
            '2.2. Date despre clienții antrenorilor',
            'Nume client; vârstă, greutate, înălțime; obiective de fitness; alergii și restricții alimentare; date despre progres (greutate săptămânală, aderență la plan).',
            '2.3. Date tehnice',
            'Adresă IP; tip browser și sistem de operare; jurnale de activitate (logs) pentru securitate și depanare.',
            '2.4. Date de marketing și atribuire reclame',
            'Dacă îți dai consimțământul pentru cookie-uri de marketing, putem prelucra prin TikTok Pixel și Meta Pixel date tehnice despre vizita pe paginile publice: URL vizitat, referrer, identificatori de click/reclamă, timestamp, adresă IP, user agent și interacțiuni generale cu pagina.',
          ],
        },
        {
          title: '3. Scopul prelucrării datelor',
          items: [
            'Furnizarea serviciului Trevano — generare planuri alimentare și de antrenament',
            'Gestionarea contului și autentificarea utilizatorului',
            'Procesarea plăților prin Stripe',
            'Comunicări legate de cont (confirmare email, facturi, notificări)',
            'Măsurarea traficului venit din campanii TikTok/Meta și optimizarea reclamelor, doar pe baza consimțământului tău',
            'Îmbunătățirea serviciului și depanarea erorilor',
            'Respectarea obligațiilor legale',
          ],
        },
        {
          title: '4. Temeiul legal al prelucrării',
          items: [
            'Executarea contractului (art. 6 alin. 1 lit. b GDPR) — pentru furnizarea serviciului',
            'Consimțământul utilizatorului (art. 6 alin. 1 lit. a GDPR) — pentru comunicări de marketing și cookie-uri/pixeli de marketing',
            'Obligație legală (art. 6 alin. 1 lit. c GDPR) — pentru facturare și contabilitate',
            'Interes legitim (art. 6 alin. 1 lit. f GDPR) — pentru securitate și prevenirea fraudelor',
          ],
        },
        {
          title: '5. Stocarea datelor',
          body: [
            'Datele sunt stocate pe servere securizate prin intermediul Supabase (UE) și Hetzner (Germania), cu criptare în tranzit (HTTPS/TLS) și în repaus.',
            'Datele de facturare sunt păstrate 10 ani conform legislației fiscale din România.',
          ],
        },
        {
          title: '6. Partajarea datelor cu terți',
          body: [
            'Nu vindem datele tale personale. Partajăm date strict în scopul furnizării serviciului cu:',
          ],
          items: [
            'Stripe Inc. — procesarea plăților (politica Stripe: stripe.com/privacy)',
            'Supabase Inc. — stocarea datelor (serverele UE)',
            'Resend Inc. — trimiterea emailurilor tranzacționale',
            'OpenAI LLC — generarea planurilor AI (doar datele necesare: obiectiv, vârstă, greutate, preferințe)',
            'SmartBill — emiterea facturilor fiscale',
            'TikTok Technology Limited / TikTok Information Technologies UK Limited — măsurarea și atribuirea campaniilor publicitare, doar dacă accepți cookie-urile de marketing',
            'Meta Platforms Ireland Limited — măsurarea și atribuirea campaniilor publicitare, doar dacă accepți cookie-urile de marketing',
          ],
          after: [
            'Toți partenerii sunt obligați contractual să respecte GDPR și să protejeze datele tale.',
            'Unii furnizori pot prelucra date în afara Spațiului Economic European. În aceste cazuri folosim garanțiile contractuale disponibile, cum ar fi clauzele contractuale standard, acolo unde sunt aplicabile.',
          ],
        },
        {
          title: '7. Drepturile tale',
          body: ['Conform GDPR, ai dreptul la:'],
          items: [
            'Acces — să primești o copie a datelor tale personale',
            'Rectificare — să corectezi datele incorecte',
            'Ștergere — să soliciți ștergerea datelor ("dreptul de a fi uitat")',
            'Restricționare — să limitezi prelucrarea datelor tale',
            'Portabilitate — să primești datele într-un format structurat',
            'Opoziție — să te opui prelucrării bazate pe interes legitim',
            'Retragerea consimțământului — oricând, fără a afecta legalitatea prelucrării anterioare',
          ],
          after: [
            'Pentru a-ți exercita drepturile, contactează-ne la: contact@trevano.app. Răspundem în maxim 30 de zile.',
            'Ai dreptul să depui plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), www.dataprotection.ro.',
          ],
        },
        {
          title: '8. Cookies',
          body: [
            'Folosim cookies tehnice necesare pentru funcționarea aplicației (sesiune de autentificare).',
            'Cu acordul tău explicit, putem folosi TikTok Pixel și Meta Pixel pe paginile publice pentru analytics publicitar și atribuire campanii. Acestea nu sunt încărcate pe rutele protejate ale aplicației și nu primesc date despre clienții antrenorilor sau planurile generate.',
            'Îți poți retrage consimțământul oricând din "Setări cookies".',
            'Pentru detalii, consultați Politica noastră de Cookies.',
          ],
        },
        {
          title: '9. Securitate',
          body: [
            'Implementăm măsuri tehnice și organizatorice adecvate pentru protejarea datelor: criptare HTTPS, parole hash bcrypt, autentificare JWT, rate limiting, și acces restricționat la baza de date.',
          ],
        },
        {
          title: '10. Modificări ale politicii',
          body: [
            'Putem actualiza această politică periodic. Te vom notifica prin email cu cel puțin 14 zile înainte de modificările semnificative. Continuarea utilizării serviciului după data intrării în vigoare constituie acceptul modificărilor.',
          ],
        },
        {
          title: '11. Contact',
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
