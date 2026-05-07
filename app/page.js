import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import LandingPage from '@/app/landing/page';

export const metadata = {
  title: 'trevano — Planuri alimentare și antrenament generate instant',
  description: 'Generează planuri alimentare și de antrenament personalizate pentru clienții tăi în 2 minute. Portal client inclus.',
};

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token');

  if (token?.value) {
    redirect('/dashboard');
  }

  return <LandingPage />;
}
