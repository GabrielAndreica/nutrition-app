import LegalPage from '@/app/components/LegalPage';

export const metadata = {
  title: 'Politica de confidențialitate | trevano',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Confidențialitate"
      title="Politica de confidențialitate"
      intro="Această politică explică pe scurt ce date sunt folosite în trevano și de ce."
      sections={[
        {
          title: 'Date colectate',
          items: [
            'Date de cont: nume, email, rol și status abonament.',
            'Date despre clienți: profil, obiective, preferințe alimentare, antrenamente și progres.',
            'Date tehnice: jurnal de activitate, erori, sesiuni și informații necesare securității.',
          ],
        },
        {
          title: 'Scopul prelucrării',
          body: [
            'Folosim datele pentru autentificare, generarea planurilor, monitorizarea progresului, trimiterea emailurilor operaționale și administrarea abonamentelor.',
          ],
        },
        {
          title: 'Servicii terțe',
          body: [
            'Platforma poate folosi servicii precum Supabase pentru baza de date, Resend pentru emailuri și Stripe pentru plăți și abonamente.',
          ],
        },
        {
          title: 'Drepturile tale',
          body: [
            'Poți solicita acces, corectare sau ștergere a datelor tale, în limitele permise de lege și de obligațiile tehnice ale platformei.',
          ],
        },
      ]}
    />
  );
}
