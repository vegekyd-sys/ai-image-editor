import {describe, expect, it} from 'vitest';
import {mediaDeliveryUrl, routeDesignMedia} from '../src/lib/media-delivery';
import type {DesignPayload} from '../src/types';

const original = 'https://sdyrtztrjgmmpnirswxt.supabase.co/storage/v1/object/public/images/owner/clip.mp4';
const destination = 'https://media-cache.makaron.app';
describe('public media delivery transport', () => {
  it('routes code and nested props without changing the authored composition or source', () => {
    const design: DesignPayload = {width: 1080, height: 1920, animation: {fps: 30, durationInSeconds: 20},
      code: `<Video src="${original}" trimBefore={45} playbackRate={1.25}/>`, props: {audio: [{src: original, volume: 0.4}]}};
    const routed = routeDesignMedia(design, destination);
    expect(routed.code).toContain('https://media-cache.makaron.app/storage/');
    expect(routed.code).toContain('trimBefore={45} playbackRate={1.25}');
    expect(routed.props).toEqual({audio: [{src: mediaDeliveryUrl(original, destination), volume: 0.4}]});
    expect(design.code).toContain(original);
    expect(routed.animation).toEqual(design.animation);
    expect(routeDesignMedia(design)).toBe(design);
  });
  it('preserves image variants, download filenames and complete URL boundaries', () => {
    const image = original.replace('/object/public/', '/render/image/public/').replace('clip.mp4', 'image.png?width=2000&quality=95&resize=contain');
    expect(mediaDeliveryUrl(image, destination)).toBe(image.replace('sdyrtztrjgmmpnirswxt.supabase.co', 'media-cache.makaron.app'));
    expect(mediaDeliveryUrl(original + '?download=clip.mp4', destination)).toContain('?download=clip.mp4');
  });
  it('leaves authentication, private files, unknown origins and unsafe destinations untouched', () => {
    for (const url of [original + '?token=secret', original.replace('/public/', '/sign/'),
      original.replace('images/owner/clip.mp4', 'images/owner/design.json'),
      original.replace('images/owner/', 'private/owner/'), original.replace('supabase.co', 'supabase.co.evil.test'),
      original.replace('owner/', 'owner/%2e%2e/'), original.replace('https:', 'http:'),
      'https://cdn.makaron.app/auth/v1/user']) expect(mediaDeliveryUrl(url, destination)).toBe(url);
    for (const target of ['https://evil.test', destination + '/prefix', destination + '?key=secret', 'http://cdn.makaron.app']) {
      expect(mediaDeliveryUrl(original, target)).toBe(original);
    }
  });
});
