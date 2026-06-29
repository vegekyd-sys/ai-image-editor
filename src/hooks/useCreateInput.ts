'use client';
import { useState, useCallback, useRef } from 'react';
import { isHeicFile, ensureDecodableFile } from '@/lib/imageUtils';

const MAX_FILES = 10;

export function useCreateInput() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<(string | null)[]>([]);
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardDragX, setCardDragX] = useState(0);

  const addFiles = useCallback(async (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    for (const file of newFiles) {
      let atLimit = false;
      setFiles(prev => {
        if (prev.length >= MAX_FILES) { atLimit = true; return prev; }
        return prev;
      });
      if (atLimit) break;

      if (file.type.startsWith('video/')) {
        setFiles(prev => [...prev, file].slice(0, MAX_FILES));
        setPreviews(prev => [...prev, null].slice(0, MAX_FILES));
        import('@/lib/video-upload').then(({ extractVideoPoster }) =>
          extractVideoPoster(file).then(poster => {
            setPreviews(prev => {
              const idx = prev.lastIndexOf(null);
              if (idx === -1) return prev;
              return prev.map((p, i) => i === idx ? poster : p);
            });
          }).catch(() => {})
        );
      } else if (isHeicFile(file)) {
        setFiles(prev => [...prev, file].slice(0, MAX_FILES));
        setPreviews(prev => [...prev, null].slice(0, MAX_FILES));
        try {
          const decodable = await ensureDecodableFile(file);
          const previewUrl = URL.createObjectURL(decodable);
          setFiles(prev => {
            const idx = prev.indexOf(file);
            if (idx === -1) return prev;
            return prev.map((f, i) => i === idx ? decodable : f);
          });
          setPreviews(prev => {
            const idx = prev.lastIndexOf(null);
            if (idx === -1) return prev;
            return prev.map((p, i) => i === idx ? previewUrl : p);
          });
        } catch {
          setPreviews(prev => {
            const idx = prev.lastIndexOf(null);
            if (idx === -1) return prev;
            return prev.map((p, i) => i === idx ? 'heic-pending' : p);
          });
        }
      } else {
        const previewUrl = URL.createObjectURL(file);
        setFiles(prev => [...prev, file].slice(0, MAX_FILES));
        setPreviews(prev => [...prev, previewUrl].slice(0, MAX_FILES));
      }
    }
    setCardIndex(999);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, j) => j !== index));
    setPreviews(prev => prev.filter((_, j) => j !== index));
  }, []);

  const restoreDraftImages = useCallback((images: string[]) => {
    if (images.length === 0) return;
    const placeholders = images.slice(0, MAX_FILES).map((_, index) =>
      new File([], `restored-draft-${index + 1}.jpg`, { type: 'image/jpeg' })
    );
    setFiles(placeholders);
    setPreviews(images.slice(0, MAX_FILES));
    setCardIndex(999);
  }, []);

  const clear = useCallback(() => {
    setFiles([]);
    setPreviews([]);
    setText('');
  }, []);

  const submit = useCallback(async (handler: (files: File[], text?: string) => Promise<void>) => {
    setCreating(true);
    try {
      await handler(files, text.trim() || undefined);
      clear();
    } catch (err) {
      setCreating(false);
      throw err;
    }
  }, [files, text, clear]);

  return {
    files, previews, text, setText, creating, setCreating,
    fileInputRef, cardIndex, setCardIndex, cardDragX, setCardDragX,
    addFiles, removeFile, restoreDraftImages, clear, submit,
  };
}

export type CreateInputState = ReturnType<typeof useCreateInput>;
