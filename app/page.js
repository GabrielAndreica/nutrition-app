import LandingPage from '@/app/landing/page';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Planul pe care îl poți urma',
  description: 'Trevano îți spune ce să mănânci, cum să te antrenezi și îți adaptează planul pe măsură ce progresezi.',
  alternates: {
    canonical: '/',
  },
};

export default async function Home() {
  return <LandingPage />;
}
