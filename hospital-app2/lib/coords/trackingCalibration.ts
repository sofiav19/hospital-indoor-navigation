export type TrackingCalibration = {
  sourceOriginX: number;
  sourceOriginY: number;
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
  flipY: boolean;
};

export const DEFAULT_TRACKING_CALIBRATION: TrackingCalibration = {
  sourceOriginX: 0,
  sourceOriginY: 0,
  offsetX: 0,
  offsetY: 0,
  rotationDeg: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  flipX: false,
  flipY: false,
};

//export const OPTITRACK_TRACKING_CALIBRATION: TrackingCalibration = {
// sourceOriginX: 0,
  //sourceOriginY: 0,
//  offsetX: 0.4246,
//  offsetY: -9.9429,
//  rotationDeg: 0,
//  scale: 1,
//  scaleX: 12.9074 / 3.8,
//  scaleY: 8.5369 / 2.4,
//  flipX: false,
//  flipY: false,
// };

// Converts raw tracker coordinates into the hospital's local map coordinates.ç
export function applyTrackingCalibration(
  input: [number, number],
  calibration: TrackingCalibration
): [number, number] {
  const {
    sourceOriginX = 0,
    sourceOriginY = 0,
    offsetX,
    offsetY,
    rotationDeg,
    scale = 1,
    scaleX = scale,
    scaleY = scale,
    flipX,
    flipY,
  } = calibration;

  // Flips are applied as sign changes so they compose cleanly with scaling.
  const flipSignX = flipX ? -1 : 1;
  const flipSignY = flipY ? -1 : 1;

  const scaledX = (input[0] - sourceOriginX) * scaleX * scale * flipSignX;
  const scaledY = (input[1] - sourceOriginY) * scaleY * scale * flipSignY;

  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const rotatedX = scaledX * cos - scaledY * sin;
  const rotatedY = scaledX * sin + scaledY * cos;

  return [rotatedX + offsetX, rotatedY + offsetY];
}
