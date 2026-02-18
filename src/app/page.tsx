'use client';

import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
      return;
    }

    if (!loading && user && !creating) {
      setCreating(true);
      // Create a new project and redirect to it
      const supabase = createClient();
      supabase
        .from('projects')
        .insert({ user_id: user.id, title: '未命名项目' })
        .select('id')
        .single()
        .then(({ data, error }) => {
          if (error || !data) {
            console.error('Failed to create project:', error);
            setCreating(false);
            return;
          }
          router.replace(`/projects/${data.id}`);
        });
    }
  }, [user, loading, router, creating]);

  return (
    <div className="h-dvh bg-black flex items-center justify-center">
      <svg className="animate-spin h-6 w-6 text-fuchsia-500" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );
}
