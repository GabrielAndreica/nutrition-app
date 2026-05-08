import LegalPage from '@/app/components/LegalPage';

export const metadata = {
  title: 'Copyright | trevano',
};

export default function CopyrightPage() {
  return (
    <LegalPage
      eyebrow="Copyright"
      title="Copyright"
      intro="Brandul trevano, designul, textele și elementele aplicației sunt protejate."
      sections={[
        {
          title: 'Drepturi rezervate',
          body: [
            '© 2026 Trevano. Toate drepturile rezervate. Conținutul aplicației nu poate fi copiat, redistribuit sau reutilizat fără acord.',
          ],
        },
        {
          title: 'Conținut generat',
          body: [
            'Planurile și materialele generate în aplicație sunt destinate utilizării în cadrul contului și relației dintre antrenor și client.',
          ],
        },
        {
          title: 'Branding',
          body: [
            'Numele trevano, logo-ul și identitatea vizuală asociată aparțin aplicației trevano.',
          ],
        },
      ]}
    />
  );
}
