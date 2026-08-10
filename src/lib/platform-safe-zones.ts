export interface PlatformRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlatformExclusionZone {
  id: string;
  label: string;
  rect: PlatformRect;
}

export interface PlatformSafeRegion {
  platform: 'tiktok';
  placement: 'organic' | 'auction-in-feed';
  direction: 'ltr';
  aspectRatio: '9:16';
  referenceWidth: number;
  referenceHeight: number;
  /** Outer canvas bounds. Exclusions, not this rectangle, define UI avoidance. */
  contentBounds: PlatformRect;
  /** Holes inside contentBounds where platform UI may cover content. */
  exclusions: PlatformExclusionZone[];
  sourceUrl?: string;
  sourceUpdatedAt: string;
  sourceKind: 'official' | 'product-default';
}

/**
 * TikTok's official 720x1280 Auction In-Feed Standard LTR template is not a
 * single rectangle. Its upper region can use x=80..640; only the lower-right
 * interaction rail removes x=520..640 from y=560..840.
 */
export const TIKTOK_AUCTION_IN_FEED_LTR_SAFE_REGION: PlatformSafeRegion = {
  platform: 'tiktok',
  placement: 'auction-in-feed',
  direction: 'ltr',
  aspectRatio: '9:16',
  referenceWidth: 720,
  referenceHeight: 1280,
  contentBounds: {
    x: 80,
    y: 160,
    width: 560,
    height: 680,
  },
  exclusions: [{
    id: 'right-interaction-rail',
    label: 'Avatar, like, comment, save, and share controls',
    rect: { x: 520, y: 560, width: 120, height: 280 },
  }],
  sourceUrl: 'https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads',
  sourceUpdatedAt: '2026-06',
  sourceKind: 'official',
};

/**
 * Default organic-post UI avoidance model. TikTok does not publish one fixed
 * device-independent organic overlay, so this describes the stable shape of
 * the app chrome as three small independent holes over an otherwise usable
 * full canvas. The bottom-left default assumes a short post caption; use a
 * taller conservative overlay for long captions or interactive add-ons.
 * Final-device preview remains authoritative.
 */
export const TIKTOK_ORGANIC_LTR_SAFE_REGION: PlatformSafeRegion = {
  platform: 'tiktok',
  placement: 'organic',
  direction: 'ltr',
  aspectRatio: '9:16',
  referenceWidth: 720,
  referenceHeight: 1280,
  contentBounds: {
    x: 0,
    y: 0,
    width: 720,
    height: 1280,
  },
  exclusions: [
    {
      id: 'top-app-chrome',
      label: 'Top navigation and status controls',
      rect: { x: 0, y: 0, width: 720, height: 80 },
    },
    {
      id: 'right-interaction-rail',
      label: 'Avatar, like, comment, save, and share controls',
      rect: { x: 600, y: 400, width: 120, height: 640 },
    },
    {
      id: 'bottom-left-post-metadata',
      label: 'Account name, short post caption, translation labels, and music line',
      rect: { x: 0, y: 1100, width: 560, height: 180 },
    },
  ],
  sourceUpdatedAt: '2026-08',
  sourceKind: 'product-default',
};

export function scalePlatformRect(
  rect: PlatformRect,
  referenceWidth: number,
  referenceHeight: number,
  width: number,
  height: number,
): PlatformRect {
  const xScale = width / referenceWidth;
  const yScale = height / referenceHeight;
  return {
    x: rect.x * xScale,
    y: rect.y * yScale,
    width: rect.width * xScale,
    height: rect.height * yScale,
  };
}

export function scalePlatformSafeRegion(
  guideline: PlatformSafeRegion,
  width: number,
  height: number,
) {
  const scale = (rect: PlatformRect) => scalePlatformRect(
    rect,
    guideline.referenceWidth,
    guideline.referenceHeight,
    width,
    height,
  );
  return {
    contentBounds: scale(guideline.contentBounds),
    exclusions: guideline.exclusions.map(zone => ({
      ...zone,
      rect: scale(zone.rect),
    })),
  };
}

export function platformRectsOverlap(a: PlatformRect, b: PlatformRect): boolean {
  return (
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
  );
}

export function platformRectFitsSafeRegion(
  rect: PlatformRect,
  guideline: PlatformSafeRegion,
): boolean {
  const bounds = guideline.contentBounds;
  const insideBounds = (
    rect.x >= bounds.x
    && rect.y >= bounds.y
    && rect.x + rect.width <= bounds.x + bounds.width
    && rect.y + rect.height <= bounds.y + bounds.height
  );
  return insideBounds && !guideline.exclusions.some(zone =>
    platformRectsOverlap(rect, zone.rect)
  );
}
