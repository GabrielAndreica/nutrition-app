import LegalPage from '@/app/components/LegalPage';

export const metadata = {
  title: 'Termeni și condiții',
  description: 'Termenii de utilizare pentru Trevano, aplicația pentru antrenori de fitness.',
  alternates: {
    canonical: '/termeni-si-conditii',
  },
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="TERMENI ȘI CONDIȚII DE UTILIZARE"
      meta={[
        'Trevano (trevano.app)',
        'Ultima actualizare: 07.05.2026',
      ]}
      sections={[
        {
          title: '1. Acceptarea termenilor',
          body: [
            'Prin crearea unui cont și utilizarea platformei Trevano (trevano.app), accepți în mod expres acești Termeni și Condiții. Dacă nu ești de acord cu aceștia, nu utiliza serviciul.',
            'Serviciul este operat de ANDREICA GABRIEL-Ioan PFA, CUI 46589606, cu sediul în Șișești, nr. 247, România.',
          ],
        },
        {
          title: '2. Descrierea serviciului',
          body: [
            'Trevano este o platformă SaaS (Software as a Service) destinată antrenorilor personali, care oferă:',
          ],
          items: [
            'Generare automată de planuri alimentare personalizate prin inteligență artificială',
            'Generare automată de planuri de antrenament personalizate prin inteligență artificială',
            'Portal pentru clienți — vizualizare planuri și trimitere progres',
            'Sistem de urmărire și ajustare automată a planurilor în funcție de progres',
            'Export PDF al planurilor',
          ],
        },
        {
          title: '3. Cont și autentificare',
          body: [
            'Pentru a utiliza Trevano trebuie să creezi un cont cu o adresă de email validă și o parolă. Ești responsabil pentru:',
          ],
          items: [
            'Confidențialitatea credențialelor de acces',
            'Toate activitățile desfășurate din contul tău',
            'Notificarea imediată a oricărui acces neautorizat la: contact@trevano.app',
          ],
          after: [
            'Nu poți crea conturi multiple pentru a beneficia de perioade de trial repetate. Rezervăm dreptul de a suspenda conturile create abuziv.',
          ],
        },
        {
          title: '4. Perioada de trial și abonament',
          body: [
            '4.1. Trial gratuit',
            'La înregistrare, beneficiezi de 14 zile de acces complet, gratuit, fără obligația de a introduce date de card. La expirarea trialului, accesul este suspendat până la subscrierea unui plan.',
            '4.2. Planuri disponibile',
          ],
          items: [
            'Starter — 149 RON/lună — până la 10 clienți activi',
            'Pro — 249 RON/lună — până la 30 clienți activi',
          ],
          after: [
            '4.3. Facturare',
            'Abonamentele sunt facturate lunar, prin card bancar, prin procesatorul de plăți Stripe. Factura fiscală este emisă automat și trimisă pe email după fiecare plată reușită.',
            '4.4. Anulare',
            'Poți anula abonamentul oricând din secțiunea "Gestionează abonamentul" din aplicație. Anularea intră în vigoare la sfârșitul perioadei de facturare curente. Nu oferim rambursări pentru perioadele parțiale.',
          ],
        },
        {
          title: '5. Utilizare acceptabilă',
          body: ['Ești de acord să nu utilizezi Trevano pentru:'],
          items: [
            'Activități ilegale sau frauduloase',
            'Prelucrarea datelor unor persoane fără consimțământul lor',
            'Distribuirea de conținut fals, înșelător sau dăunător',
            'Tentative de acces neautorizat la sistemele noastre',
            'Revânzarea sau redistribuirea serviciului fără acordul nostru scris',
          ],
        },
        {
          title: '6. Datele clienților antrenorilor',
          body: ['Ca antrenor, ești responsabil pentru:'],
          items: [
            'Obținerea consimțământului clienților tăi pentru prelucrarea datelor lor personale prin Trevano',
            'Informarea clienților cu privire la utilizarea datelor lor',
            'Respectarea GDPR în relația cu clienții tăi',
          ],
          after: [
            'Trevano procesează datele clienților tăi ca împuternicit al tău, în baza instrucțiunilor tale.',
          ],
        },
        {
          title: '7. Planurile generate de AI',
          body: [
            'Planurile alimentare și de antrenament generate de Trevano sunt create prin inteligență artificială și au caracter informativ. Acestea:',
          ],
          items: [
            'Nu constituie consultanță medicală sau dietetică',
            'Nu înlocuiesc evaluarea unui medic, nutriționist sau specialist în fitness',
          ],
          after: [
            'Nu suntem răspunzători pentru consecințele utilizării planurilor generate fără supervizarea unui profesionist calificat.',
          ],
        },
        {
          title: '8. Proprietate intelectuală',
          body: [
            'Platforma Trevano, codul sursă, designul și conținutul sunt proprietatea exclusivă a ANDREICA GABRIEL-IOAN PFA. Planurile generate pentru clienții tăi îți aparțin ție ca utilizator.',
          ],
        },
        {
          title: '9. Disponibilitatea serviciului',
          body: [
            'Ne străduim să menținem disponibilitatea serviciului 24/7, dar nu garantăm funcționarea neîntreruptă. Rezervăm dreptul de a efectua întreținere programată cu notificare prealabilă.',
            'Nu suntem răspunzători pentru pierderile cauzate de indisponibilitatea temporară a serviciului.',
          ],
        },
        {
          title: '10. Limitarea răspunderii',
          body: ['Nu suntem răspunzători pentru daune indirecte, pierderi de profit sau de date.'],
        },
        {
          title: '11. Modificări ale termenilor',
          body: [
            'Putem modifica acești termeni cu o notificare de 14 zile transmisă prin email. Continuarea utilizării serviciului după această perioadă constituie acceptul noilor termeni.',
          ],
        },
        {
          title: '12. Legea aplicabilă',
          body: [
            'Acești termeni sunt guvernați de legea română. Orice litigiu va fi soluționat de instanțele competente din România.',
          ],
        },
        {
          title: '13. Contact',
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
