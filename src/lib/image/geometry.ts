export interface FittedRect {
  l: number;
  t: number;
  w: number;
  h: number;
}

export function containRect(cW: number, cH: number, ar: number): FittedRect {
  let w: number;
  let h: number;
  if (ar > cW / cH) {
    w = cW;
    h = cW / ar;
  } else {
    h = cH;
    w = cH * ar;
  }
  return { l: (cW - w) / 2, t: (cH - h) / 2, w, h };
}

export function coverRect(cW: number, cH: number, ar: number): FittedRect {
  let w: number;
  let h: number;
  if (ar > cW / cH) {
    h = cH;
    w = cH * ar;
  } else {
    w = cW;
    h = cW / ar;
  }
  return { l: (cW - w) / 2, t: (cH - h) / 2, w, h };
}
