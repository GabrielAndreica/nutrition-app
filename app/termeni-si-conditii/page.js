import LegalPage from '@/app/components/LegalPage';

export const metadata = {
  title: 'Termeni și condiții | trevano',
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Termeni și condiții"
      intro="Acești termeni descriu regulile generale de utilizare a platformei trevano."
      sections={[
        {
          title: 'Utilizarea platformei',
          body: [
            'trevano oferă instrumente digitale pentru antrenori și clienți: planuri alimentare, planuri de antrenament, progres și administrarea contului.',
            'Utilizatorii sunt responsabili pentru corectitudinea datelor introduse și pentru modul în care folosesc informațiile generate în aplicație.',
          ],
        },
        {
          title: 'Conturi și acces',
          body: [
            'Accesul la funcționalitățile platformei poate necesita cont activ, autentificare și, pentru antrenori, abonament valid.',
            'Datele de autentificare trebuie păstrate confidențiale. Orice activitate realizată prin contul tău este responsabilitatea ta.',
          ],
        },
        {
          title: 'Abonamente',
          body: [
            'Abonamentele sunt gestionate prin Stripe. Plata, anularea, actualizarea metodei de plată și facturile se gestionează prin portalul Stripe.',
            'Funcționalitățile disponibile pot depinde de planul ales și de statusul abonamentului.',
          ],
        },
        {
          title: 'Limitări',
          body: [
            'trevano nu înlocuiește consultanța medicală. Pentru condiții medicale, alergii severe sau restricții speciale, utilizatorii trebuie să consulte un specialist.',
          ],
        },
      ]}
    />
  );
}
