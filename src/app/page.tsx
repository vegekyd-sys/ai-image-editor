import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import LandingPage from './landingpage/page';

export default async function Home() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.user) {
    redirect('/projects');
  }

  return <LandingPage />;
}
