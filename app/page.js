import LandingPage from '@/app/landing/page';

export const metadata = {
  title: 'Trevano — Aplicație pentru antrenori de fitness',
  description: 'Trevano este aplicația pentru antrenori de fitness unde ții clienții, planurile alimentare, antrenamentele și progresul într-un singur loc.',
  alternates: {
    canonical: '/',
  },
};

export default async function Home() {
  return <LandingPage />;
}
