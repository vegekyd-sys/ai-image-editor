import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) redirect('/projects');
  } catch (e) {
    if (typeof e === 'object' && e !== null && 'digest' in e) throw e;
  }
  redirect('/home');
}
