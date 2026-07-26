import { beforeEach, describe, expect, it } from 'vitest';
import type { EditableField } from '@/types';
import {
  buildLegacySceneRegistry,
  closestEditableRuntimeElement,
  editableRuntimeClassName,
  findSceneMediaElement,
  readEditableRuntimeId,
} from '@/lib/editor/scene-registry';

const canvasRect = {
  left: 0,
  top: 0,
  width: 1920,
  height: 1080,
  right: 1920,
  bottom: 1080,
};

function setRect(
  element: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
) {
  element.getBoundingClientRect = () => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect);
}

function field(id: string, type: EditableField['type']): EditableField {
  return { id, type, label: id, propKey: id };
}

describe('legacy editable scene registry', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('selects the real text leaf instead of a same-id full-canvas ancestor', () => {
    const container = document.createElement('div');
    const canvasShell = document.createElement('div');
    const titleLeaf = document.createElement('div');

    canvasShell.dataset.editable = 'title0';
    titleLeaf.dataset.editable = 'title0';
    titleLeaf.textContent = 'Apple Vision Pro';
    canvasShell.appendChild(titleLeaf);
    container.appendChild(canvasShell);
    document.body.appendChild(container);

    setRect(canvasShell, { left: 0, top: 0, width: 1920, height: 1080 });
    setRect(titleLeaf, { left: 130, top: 270, width: 790, height: 96 });

    const registry = buildLegacySceneRegistry({
      container,
      fields: [field('title0', 'text')],
      canvasRect,
    });

    expect(registry.get('title0')?.instances).toHaveLength(2);
    expect(registry.get('title0')?.activeInstance?.element).toBe(titleLeaf);
    expect(registry.get('title0')?.activeInstance?.isCanvasCover).toBe(false);
  });

  it('rejects collapsed Remotion measurement copies before choosing an active instance', () => {
    const container = document.createElement('div');
    const collapsedCopy = document.createElement('div');
    const visibleTitle = document.createElement('div');

    collapsedCopy.dataset.editable = 'title0';
    visibleTitle.dataset.editable = 'title0';
    visibleTitle.textContent = 'Spatial computing';
    container.append(collapsedCopy, visibleTitle);
    document.body.appendChild(container);

    setRect(collapsedCopy, { left: 0, top: 0, width: 0.52, height: 96 });
    setRect(visibleTitle, { left: 130, top: 270, width: 790, height: 96 });

    const registry = buildLegacySceneRegistry({
      container,
      fields: [field('title0', 'text')],
      canvasRect,
    });

    expect(registry.get('title0')?.instances).toHaveLength(1);
    expect(registry.get('title0')?.activeInstance?.element).toBe(visibleTitle);
  });

  it('selects the image node nearest to real media instead of an editable scene shell', () => {
    const container = document.createElement('div');
    const sceneShell = document.createElement('div');
    const imageLeaf = document.createElement('div');
    const image = document.createElement('img');

    sceneShell.dataset.editable = 'image0';
    imageLeaf.dataset.editable = 'image0';
    imageLeaf.appendChild(image);
    sceneShell.appendChild(imageLeaf);
    container.appendChild(sceneShell);
    document.body.appendChild(container);

    setRect(sceneShell, { left: 0, top: 0, width: 1920, height: 1080 });
    setRect(imageLeaf, { left: 960, top: 100, width: 780, height: 780 });
    setRect(image, { left: 960, top: 100, width: 780, height: 780 });

    const registry = buildLegacySceneRegistry({
      container,
      fields: [field('image0', 'image')],
      canvasRect,
    });

    expect(registry.get('image0')?.activeInstance?.element).toBe(imageLeaf);
  });

  it('resolves media from both a direct video host and a wrapper host', () => {
    const directVideo = document.createElement('video');
    const wrapper = document.createElement('div');
    const nestedVideo = document.createElement('video');
    wrapper.appendChild(nestedVideo);

    expect(findSceneMediaElement(directVideo, 'video')).toBe(directVideo);
    expect(findSceneMediaElement(wrapper, 'video')).toBe(nestedVideo);
  });

  it('resolves a direct Remotion Video through its forwarded runtime class', () => {
    const container = document.createElement('div');
    const directVideo = document.createElement('video');
    directVideo.className = `agent-class ${editableRuntimeClassName('hero video')}`;
    container.appendChild(directVideo);
    document.body.appendChild(container);
    setRect(directVideo, { left: 120, top: 80, width: 960, height: 720 });

    const registry = buildLegacySceneRegistry({
      container,
      fields: [field('hero video', 'video')],
      canvasRect,
    });

    expect(registry.get('hero video')?.activeInstance?.element).toBe(directVideo);
    expect(readEditableRuntimeId(directVideo)).toBe('hero video');
    expect(closestEditableRuntimeElement(directVideo)).toBe(directVideo);
  });

  it('keeps separate logical nodes while preserving DOM order for hit-testing', () => {
    const container = document.createElement('div');
    const background = document.createElement('div');
    const title = document.createElement('div');

    background.dataset.editable = 'image0';
    background.appendChild(document.createElement('img'));
    title.dataset.editable = 'title0';
    title.textContent = 'Hello';
    container.append(background, title);
    document.body.appendChild(container);

    setRect(background, { left: 0, top: 0, width: 1920, height: 1080 });
    setRect(title, { left: 100, top: 100, width: 400, height: 80 });

    const registry = buildLegacySceneRegistry({
      container,
      fields: [field('image0', 'image'), field('title0', 'text')],
      canvasRect,
    });

    expect(registry.activeInstances().map(instance => instance.id)).toEqual([
      'image0',
      'title0',
    ]);
  });

  it('resolves nested scene wrappers to each field leaf independently', () => {
    const container = document.createElement('div');
    const imageShell = document.createElement('div');
    const numberShell = document.createElement('div');
    const titleShell = document.createElement('div');
    const imageLeaf = document.createElement('div');
    const image = document.createElement('img');
    const numberLeaf = document.createElement('span');
    const titleLeaf = document.createElement('div');

    imageShell.dataset.editable = 'image0';
    numberShell.dataset.editable = 'number0';
    titleShell.dataset.editable = 'title0';
    imageLeaf.dataset.editable = 'image0';
    numberLeaf.dataset.editable = 'number0';
    titleLeaf.dataset.editable = 'title0';
    numberLeaf.textContent = '01';
    titleLeaf.textContent = 'Apple Vision Pro';
    imageLeaf.appendChild(image);
    titleShell.append(imageLeaf, numberLeaf, titleLeaf);
    numberShell.appendChild(titleShell);
    imageShell.appendChild(numberShell);
    container.appendChild(imageShell);
    document.body.appendChild(container);

    setRect(imageShell, { left: 0, top: 0, width: 1920, height: 1080 });
    setRect(numberShell, { left: 0, top: 0, width: 1920, height: 1080 });
    setRect(titleShell, { left: 0, top: 0, width: 1920, height: 1080 });
    setRect(imageLeaf, { left: 980, top: 120, width: 700, height: 700 });
    setRect(image, { left: 980, top: 120, width: 700, height: 700 });
    setRect(numberLeaf, { left: 130, top: 210, width: 64, height: 48 });
    setRect(titleLeaf, { left: 130, top: 280, width: 760, height: 96 });

    const registry = buildLegacySceneRegistry({
      container,
      fields: [
        field('image0', 'image'),
        field('number0', 'text'),
        field('title0', 'text'),
      ],
      canvasRect,
    });

    expect(registry.get('image0')?.activeInstance?.element).toBe(imageLeaf);
    expect(registry.get('number0')?.activeInstance?.element).toBe(numberLeaf);
    expect(registry.get('title0')?.activeInstance?.element).toBe(titleLeaf);
  });

});
