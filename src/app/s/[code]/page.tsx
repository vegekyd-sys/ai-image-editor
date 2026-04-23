'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

interface SkillPreview {
  skillName: string;
  description: string;
  icon: string;
  color: string;
}

type PageState = 'loading' | 'preview' | 'claiming' | 'success' | 'expired' | 'error';

export default function ClaimPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [state, setState] = useState<PageState>('loading');
  const [skill, setSkill] = useState<SkillPreview | null>(null);
  const [claimedName, setClaimedName] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session?.user);
    });

    fetch(`/api/skills/share/${code}`).then(async (res) => {
      if (!res.ok) {
        setState('expired');
        return;
      }
      const data = await res.json();
      if (data.expired) {
        setState('expired');
        return;
      }
      setSkill(data);
      setState('preview');
    }).catch(() => setState('error'));
  }, [code]);

  async function handleClaim() {
    if (!isLoggedIn) {
      router.push(`/login?redirect=/s/${code}`);
      return;
    }

    setState('claiming');
    try {
      const res = await fetch('/api/skills/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to claim skill');
        setState('error');
        return;
      }
      setClaimedName(data.skillName);
      setState('success');
    } catch {
      setErrorMsg('Network error');
      setState('error');
    }
  }

  function handleGoToProjects() {
    router.push(`/projects?skill=${encodeURIComponent(claimedName)}`);
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        maxWidth: 400,
        width: '100%',
        borderRadius: 20,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        padding: '40px 32px',
        textAlign: 'center',
      }}>
        {state === 'loading' && (
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Loading...</p>
        )}

        {state === 'preview' && skill && (
          <>
            {skill.icon && (
              <div style={{ fontSize: 48, marginBottom: 16 }}>{skill.icon}</div>
            )}
            <h1 style={{
              color: '#fff',
              fontSize: 22,
              fontWeight: 700,
              margin: '0 0 8px',
            }}>
              {skill.skillName.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}
            </h1>
            {skill.description && (
              <p style={{
                color: 'rgba(255,255,255,0.55)',
                fontSize: 14,
                lineHeight: 1.5,
                margin: '0 0 28px',
              }}>
                {skill.description.split('\n')[0]}
              </p>
            )}
            <button
              onClick={handleClaim}
              style={{
                width: '100%',
                padding: '14px 0',
                borderRadius: 12,
                border: 'none',
                background: skill.color || '#d946ef',
                color: '#fff',
                fontSize: 16,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              {isLoggedIn ? 'Add to My Skills' : 'Log in to Add'}
            </button>
          </>
        )}

        {state === 'claiming' && (
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Adding skill...</p>
        )}

        {state === 'success' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#10003;</div>
            <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
              Skill Added!
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, margin: '0 0 28px' }}>
              {claimedName.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}
            </p>
            <button
              onClick={handleGoToProjects}
              style={{
                width: '100%',
                padding: '14px 0',
                borderRadius: 12,
                border: 'none',
                background: '#d946ef',
                color: '#fff',
                fontSize: 16,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              Go to Projects
            </button>
          </>
        )}

        {state === 'expired' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.4 }}>&#128279;</div>
            <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
              Link Expired
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: '0 0 28px' }}>
              This skill is no longer available.
            </p>
          </>
        )}

        {state === 'error' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.4 }}>&#9888;</div>
            <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
              Something went wrong
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }}>
              {errorMsg || 'Please try again later.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
