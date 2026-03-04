export const AZIMUTH_MAP: Record<number, string> = {
  0: 'front view',
  45: 'front-right quarter view',
  90: 'right side view',
  135: 'back-right quarter view',
  180: 'back view',
  225: 'back-left quarter view',
  270: 'left side view',
  315: 'front-left quarter view',
};

export const ELEVATION_MAP: Record<number, string> = {
  [-30]: 'low-angle shot',
  0: 'eye-level shot',
  30: 'elevated shot',
  60: 'high-angle shot',
};

export const DISTANCE_MAP: Record<number, string> = {
  0.6: 'close-up',
  1.0: 'medium shot',
  1.4: 'wide shot',
};

export const AZIMUTH_STEPS = [0, 45, 90, 135, 180, 225, 270, 315];
export const ELEVATION_STEPS = [-30, 0, 30, 60];
export const DISTANCE_STEPS = [0.6, 1.0, 1.4];

// 8 direction arrows for azimuth quick-select
export const AZIMUTH_ARROWS: { deg: number; label: string }[] = [
  { deg: 0, label: '↑' },
  { deg: 45, label: '↗' },
  { deg: 90, label: '→' },
  { deg: 135, label: '↘' },
  { deg: 180, label: '↓' },
  { deg: 225, label: '↙' },
  { deg: 270, label: '←' },
  { deg: 315, label: '↖' },
];

export function snapToNearest(value: number, options: number[]): number {
  return options.reduce((prev, curr) =>
    Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
  );
}

export function buildCameraPrompt(
  azimuth: number,
  elevation: number,
  distance: number,
): string {
  const azSnap = snapToNearest(azimuth, AZIMUTH_STEPS);
  const elSnap = snapToNearest(elevation, ELEVATION_STEPS);
  const dsSnap = snapToNearest(distance, DISTANCE_STEPS);

  return `<sks> ${AZIMUTH_MAP[azSnap]} ${ELEVATION_MAP[elSnap]} ${DISTANCE_MAP[dsSnap]}`;
}

export interface CameraState {
  azimuth: number;
  elevation: number;
  distance: number;
}

export const DEFAULT_CAMERA_STATE: CameraState = {
  azimuth: 0,
  elevation: 0,
  distance: 1.0,
};
