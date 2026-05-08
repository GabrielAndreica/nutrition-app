import LandingPage from '@/app/landing/page';

export const metadata = {
  title: 'trevano — Planuri alimentare și antrenament generate instant',
  description: 'Generează planuri alimentare și de antrenament personalizate pentru clienții tăi în 2 minute. Portal client inclus.',
};

export default async function Home() {
  return <LandingPage />;
}
