'use client';

import { useState, useEffect } from 'react';

interface FileViewerProps {
  path: string;
  onClose: () => void;
}

export default function FileViewer({ path, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = path.split('/').pop() || path;

  useEffect(() => {
    // Try to read file from workspace via API or local fetch
    const loadFile = async () => {
      setLoading(true);
      setError(null);
      try {
        // Try fetching from workspace API (if available)
        // Fallback: fetch from src/skills/ or src/lib/prompts/ paths
        const candidates = [
          `/api/workspace/read?path=${encodeURIComponent(path)}`,
        ];
        let loaded = false;
        for (const url of candidates) {
          try {
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.json();
              setContent(data.content || 'Empty file');
              loaded = true;
              break;
            }
          } catch {
            // try next
          }
        }
        if (!loaded) {
          setContent(`[Unable to load file: ${path}]\n\nThe file content will be available when the workspace API is connected.`);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    };
    loadFile();
  }, [path]);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-[90vw] max-w-[600px] max-h-[70vh] rounded-2xl overflow-hidden"
        style={{ background: '#1a1a2e' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm opacity-60">📄</span>
            <span className="font-mono text-sm text-white/80 truncate">{path}</span>
          </div>
          <button
            className="text-white/40 hover:text-white/80 transition-colors px-2 py-1 rounded-lg hover:bg-white/10"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-4" style={{ maxHeight: 'calc(70vh - 56px)' }}>
          {loading && (
            <div className="text-white/30 text-sm animate-pulse">Loading...</div>
          )}
          {error && (
            <div className="text-red-400/80 text-sm">{error}</div>
          )}
          {content && (
            <pre className="font-mono text-sm text-white/80 whitespace-pre-wrap break-words leading-relaxed">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
