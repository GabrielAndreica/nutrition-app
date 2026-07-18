import LandingPage from '@/app/landing/page';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Trevano - Planul pe care il poti urma',
  description: 'Trevano iti spune ce sa mananci, cum sa te antrenezi si iti adapteaza planul pe masura ce progresezi.',
  alternates: {
    canonical: '/',
  },
};

export default async function Home() {
  return <LandingPage />;
}
