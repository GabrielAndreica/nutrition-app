import LegalPage from '@/app/components/LegalPage';

export const metadata = {
  title: 'Politica de confidențialitate',
  description: 'Cum protejează Trevano datele utilizatorilor care folosesc planurile de alimentație, antrenament și progres.',
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
        'Ultima actualizare: 19.07.2026',
      ]}
      sections={[
        {
          title: '1. Introducere',
          body: [
            'Prezenta Politică de Confidențialitate explică modul în care Trevano colectează, utilizează și protejează datele tale cu caracter personal atunci când utilizezi aplicația și website-ul nostru.',
            'Prin utilizarea Trevano confirmi că ai citit această politică.',
            'Operatorul datelor este:',
            'ANDREICA GABRIEL-Ioan PFA',
            'CUI: 46589606',
            'Website: https://trevano.app',
          ],
        },
        {
          title: '2. Ce date colectăm',
          body: [
            'În funcție de modul în care utilizezi aplicația, putem colecta următoarele categorii de date.',
            '2.1 Date de identificare',
          ],
          items: [
            'nume (dacă este furnizat);',
            'adresă de email;',
            'parola contului (stocată exclusiv în formă criptată).',
          ],
          after: [
            '2.2 Date introduse în aplicație',
            'Pentru a putea genera recomandări personalizate putem prelucra informații precum:',
            'vârsta; sexul; înălțimea; greutatea; greutatea dorită; nivelul de activitate; obiectivul utilizatorului; preferințe alimentare; restricții alimentare; alergii declarate; experiența în antrenamente; disponibilitatea pentru antrenament; alte informații introduse voluntar.',
            '2.3 Date privind progresul',
            'Pe durata utilizării aplicației putem prelucra: greutatea introdusă la check-in-uri; istoricul progresului; finalizarea misiunilor; istoricul activităților din aplicație; utilizarea funcționalităților.',
            '2.4 Date tehnice',
            'Pentru funcționarea și securitatea serviciului putem colecta: adresa IP; browserul utilizat; sistemul de operare; identificatori ai dispozitivului; log-uri tehnice; informații privind sesiunile de autentificare.',
          ],
        },
        {
          title: '3. Cum folosim datele',
          body: [
            'Datele sunt utilizate pentru:',
          ],
          items: [
            'crearea și administrarea contului;',
            'autentificarea utilizatorului;',
            'generarea planurilor personalizate;',
            'personalizarea recomandărilor;',
            'urmărirea progresului;',
            'adaptarea planurilor în funcție de evoluția utilizatorului;',
            'furnizarea funcționalităților premium;',
            'emiterea documentelor fiscale;',
            'comunicări privind contul;',
            'îmbunătățirea serviciului;',
            'prevenirea fraudelor;',
            'respectarea obligațiilor legale.',
          ],
        },
        {
          title: '4. Temeiul legal al prelucrării',
          body: [
            'Datele sunt prelucrate în baza:',
          ],
          items: [
            'executării contractului dintre utilizator și Trevano;',
            'obligațiilor legale;',
            'interesului legitim privind securitatea și funcționarea serviciului;',
            'consimțământului utilizatorului, acolo unde acesta este necesar.',
          ],
        },
        {
          title: '5. Servicii terțe',
          body: [
            'Pentru funcționarea aplicației colaborăm cu furnizori terți.',
            'În funcție de serviciile utilizate, datele pot fi prelucrate de:',
          ],
          items: [
            'Stripe – procesarea plăților;',
            'Supabase – infrastructura bazei de date și autentificare;',
            'OpenAI – generarea recomandărilor și funcționalităților bazate pe inteligență artificială;',
            'Resend – transmiterea emailurilor tranzacționale;',
            'SmartBill (sau alt furnizor de facturare utilizat) – emiterea facturilor;',
            'Meta Platforms Ireland Limited – măsurarea performanței campaniilor publicitare (numai cu acordul utilizatorului);',
            'TikTok Technology Limited – măsurarea performanței campaniilor publicitare (numai cu acordul utilizatorului).',
          ],
          after: [
            'Nu vindem și nu închiriem datele tale personale.',
          ],
        },
        {
          title: '6. Inteligența artificială',
          body: [
            'Pentru furnizarea anumitor funcționalități, Trevano utilizează modele de inteligență artificială.',
            'În acest scop pot fi transmise exclusiv informațiile necesare pentru generarea recomandărilor personalizate, cum ar fi:',
          ],
          items: [
            'obiectivul utilizatorului;',
            'date antropometrice;',
            'preferințele alimentare;',
            'informațiile necesare personalizării planurilor.',
          ],
          after: [
            'Aceste informații sunt utilizate exclusiv pentru furnizarea serviciului.',
          ],
        },
        {
          title: '7. Stocarea datelor',
          body: [
            'Datele sunt stocate pe infrastructură securizată.',
            'Aplicăm măsuri tehnice și organizatorice pentru protejarea acestora, inclusiv:',
          ],
          items: [
            'conexiuni criptate HTTPS/TLS;',
            'parole criptate;',
            'controlul accesului;',
            'monitorizarea securității;',
            'copii de siguranță.',
          ],
          after: [
            'Datele sunt păstrate doar atât timp cât este necesar pentru furnizarea serviciului sau pentru respectarea obligațiilor legale.',
            'Datele fiscale sunt păstrate conform legislației române.',
          ],
        },
        {
          title: '8. Cookie-uri',
          body: [
            'Website-ul utilizează cookie-uri necesare funcționării serviciului.',
            'Cu acordul utilizatorului pot fi utilizate cookie-uri și tehnologii similare pentru:',
          ],
          items: [
            'măsurarea traficului;',
            'analiza performanței;',
            'măsurarea campaniilor publicitare;',
            'îmbunătățirea experienței utilizatorului.',
          ],
          after: [
            'Consimțământul poate fi retras oricând din Setările cookie-urilor.',
          ],
        },
        {
          title: '9. Drepturile utilizatorului',
          body: [
            'Conform Regulamentului (UE) 2016/679 (GDPR), ai dreptul la:',
          ],
          items: [
            'acces la date;',
            'rectificarea datelor;',
            'ștergerea datelor;',
            'restricționarea prelucrării;',
            'portabilitatea datelor;',
            'opoziție la prelucrare;',
            'retragerea consimțământului, atunci când prelucrarea se bazează pe acesta.',
          ],
          after: [
            'Solicitările pot fi transmise la:',
            'contact@trevano.app',
            'Vom răspunde în termenul prevăzut de legislația aplicabilă.',
            'Ai dreptul să depui o plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP).',
          ],
        },
        {
          title: '10. Securitatea datelor',
          body: [
            'Depunem toate eforturile pentru protejarea informațiilor utilizatorilor.',
            'Cu toate acestea, niciun sistem informatic nu poate garanta securitate absolută.',
            'În cazul identificării unui incident de securitate, vom acționa în conformitate cu obligațiile prevăzute de legislația aplicabilă.',
          ],
        },
        {
          title: '11. Modificarea politicii',
          body: [
            'Prezenta Politică de Confidențialitate poate fi actualizată periodic.',
            'Versiunea actualizată va fi publicată pe website și va produce efecte de la data publicării.',
          ],
        },
        {
          title: '12. Contact',
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
