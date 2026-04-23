'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/lib/i18n';

interface SkillItem {
  name: string;
  label: string;
  icon: string;
  color: string;
  builtIn: boolean;
  description: string;
}

export default function SkillsPage() {
  const router = useRouter();
  const { locale } = useLocale();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      if (data.skills) setSkills(data.skills);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  async function handleShare(skillName: string) {
    setSharing(skillName);
    try {
      const res = await fetch('/api/skills/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setShareToast(data.error || 'Failed to create share link');
        setTimeout(() => setShareToast(null), 3000);
        return;
      }

      if (navigator.share) {
        try {
          await navigator.share({ title: `Makaron Skill`, url: data.url });
        } catch {
          // User cancelled share
        }
      } else {
        await navigator.clipboard.writeText(data.url);
        setShareToast(locale === 'zh' ? '链接已复制' : 'Link copied!');
        setTimeout(() => setShareToast(null), 2000);
      }
    } catch {
      setShareToast('Failed');
      setTimeout(() => setShareToast(null), 3000);
    } finally {
      setSharing(null);
    }
  }

  async function handleDelete(skillName: string) {
    try {
      await fetch('/api/skills', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: skillName }),
      });
      setSkills(prev => prev.filter(s => s.name !== skillName));
    } catch {}
  }

  async function handleUpload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/skills', { method: 'POST', body: form });
      const data = await res.json();
      if (data.success) await fetchSkills();
    } catch {}
    setUploading(false);
  }

  const userSkills = skills.filter(s => !s.builtIn);
  const builtInSkills = skills.filter(s => s.builtIn);

  return (
    <div style={{ minHeight: '100dvh', background: '#000', color: '#fff', padding: '0 20px 40px' }}>
      {/* Header */}
      <div style={{ padding: '20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => router.push('/projects')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.5)', fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 6,
            transition: 'color 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.8)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {locale === 'zh' ? '返回' : 'Back'}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
            color: 'rgba(255,255,255,0.6)', fontSize: 13,
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
        >
          {uploading ? (locale === 'zh' ? '上传中...' : 'Uploading...') : '+ Skill'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.target.value = '';
          }}
        />
      </div>

      {/* Title */}
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 24px', letterSpacing: '-0.02em' }}>
        Skills
      </h1>

      {loading && (
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Loading...</p>
      )}

      {/* User Skills */}
      {userSkills.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
            {locale === 'zh' ? '我的 Skills' : 'My Skills'}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {userSkills.map(skill => (
              <SkillRow
                key={skill.name}
                skill={skill}
                onShare={() => handleShare(skill.name)}
                onDelete={() => handleDelete(skill.name)}
                sharing={sharing === skill.name}
              />
            ))}
          </div>
        </div>
      )}

      {/* Built-in Skills */}
      {builtInSkills.length > 0 && (
        <div>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
            {locale === 'zh' ? '内置 Skills' : 'Built-in'}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {builtInSkills.map(skill => (
              <SkillRow key={skill.name} skill={skill} />
            ))}
          </div>
        </div>
      )}

      {!loading && skills.length === 0 && (
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14, textAlign: 'center', marginTop: 60 }}>
          {locale === 'zh' ? '还没有任何 Skill' : 'No skills yet'}
        </p>
      )}

      {/* Toast */}
      {shareToast && (
        <div style={{
          position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(12px)',
          borderRadius: 10, padding: '10px 20px',
          color: '#fff', fontSize: 14, fontWeight: 500,
          zIndex: 1000, pointerEvents: 'none',
        }}>
          {shareToast}
        </div>
      )}
    </div>
  );
}

function SkillRow({ skill, onShare, onDelete, sharing }: {
  skill: { name: string; label: string; icon: string; color: string; description: string; builtIn: boolean };
  onShare?: () => void;
  onDelete?: () => void;
  sharing?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px', borderRadius: 14,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      transition: 'background 0.15s',
    }}>
      {/* Icon */}
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: `${skill.color}20`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18, flexShrink: 0,
      }}>
        {skill.icon || skill.name[0].toUpperCase()}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 2 }}>
          {skill.label}
        </div>
        {skill.description && (
          <div style={{
            fontSize: 12, color: 'rgba(255,255,255,0.4)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {skill.description.split('\n')[0]}
          </div>
        )}
      </div>

      {/* Actions */}
      {onShare && (
        <button
          onClick={onShare}
          disabled={sharing}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.35)', padding: 6,
            transition: 'color 0.15s', flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}
          title="Share"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.25)', padding: 6,
            transition: 'color 0.15s', flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(239,68,68,0.7)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}
          title="Delete"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}
    </div>
  );
}
