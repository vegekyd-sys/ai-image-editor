'use client';
import { useEffect, useRef } from 'react';
import { editableMediaImage, editableViewportMatrix, imagePaintRect } from '@/lib/editor/editable-image-alpha';

/** Selection-only decoration. It never enters design props or the export tree. */
export default function EditableSelectionTint({ element, overlay, moving }: { element: HTMLElement; overlay: HTMLDivElement | null; moving: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let textFingerprint = '';
    const update = () => {
      cancelAnimationFrame(raf); raf = 0;
      const target = ref.current, image = editableMediaImage(element);
      if (!target || !overlay || (image && !image.naturalWidth)) return;
      const subject = image || element;
      const geometry = editableViewportMatrix(subject);
      if (!geometry) { target.style.display = 'none'; return; }
      const { matrix: m, width, height } = geometry, base = overlay.getBoundingClientRect(), style = getComputedStyle(subject);
      Object.assign(target.style, { display: 'block', width: `${width}px`, height: `${height}px`, transformOrigin: '0 0',
        transform: `matrix(${m.a},${m.b},${m.c},${m.d},${m.e - base.left},${m.f - base.top})`,
        borderRadius: style.borderRadius, clipPath: style.clipPath });
      if (image) {
        const paint = imagePaintRect({ width, height }, { width: image.naturalWidth, height: image.naturalHeight }, style.objectFit, style.objectPosition);
        Object.assign(target.style, { background: 'rgba(255, 130, 185, 0.20)',
          maskImage: `url(${JSON.stringify(image.currentSrc || image.src)})`, WebkitMaskImage: `url(${JSON.stringify(image.currentSrc || image.src)})`,
          maskSize: `${paint.width}px ${paint.height}px`, WebkitMaskSize: `${paint.width}px ${paint.height}px`,
          maskPosition: `${paint.left}px ${paint.top}px`, WebkitMaskPosition: `${paint.left}px ${paint.top}px` });
      } else {
        target.style.background = 'transparent'; target.style.maskImage = 'none'; target.style.webkitMaskImage = 'none';
        const fingerprint = `${element.innerHTML}:${style.font}:${style.lineHeight}:${width}:${height}`;
        if (fingerprint !== textFingerprint) {
          textFingerprint = fingerprint;
          const clone = element.cloneNode(true) as HTMLElement;
          const originals = [element, ...Array.from(element.querySelectorAll<HTMLElement>('*'))];
          const clones = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))];
          originals.forEach((original, index) => {
            const copy = clones[index], computed = getComputedStyle(original);
            for (const key of Array.from(computed)) copy.style.setProperty(key, computed.getPropertyValue(key));
            copy.removeAttribute('data-editable'); copy.removeAttribute('data-editable-selected'); copy.removeAttribute('class');
            Object.assign(copy.style, { color: 'rgba(255,130,185,.20)', WebkitTextFillColor: 'rgba(255,130,185,.20)',
              background: 'transparent', backgroundImage: 'none', borderColor: 'transparent', boxShadow: 'none', textShadow: 'none', pointerEvents: 'none' });
            if (copy.matches('img,video,canvas')) copy.style.visibility = 'hidden';
          });
          Object.assign(clone.style, { position: 'absolute', left: '0', top: '0', margin: '0',
            width: `${width}px`, height: `${height}px`, boxSizing: 'border-box', transform: 'none', translate: 'none', rotate: 'none', scale: 'none' });
          target.replaceChildren(clone);
        }
      }
      if (moving) raf = requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(element);
    const mutations = new MutationObserver(update); mutations.observe(element, { attributes: true, childList: true, characterData: true, subtree: true });
    const image = editableMediaImage(element); image?.addEventListener('load', update);
    window.addEventListener('scroll', update, true); window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); mutations.disconnect(); image?.removeEventListener('load', update); window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [element, overlay, moving]);
  return <div ref={ref} data-editable-selection-tint aria-hidden="true" className="absolute left-0 top-0 pointer-events-none" style={{ display: 'none', background: 'rgba(255, 130, 185, 0.20)', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' }} />;
}
