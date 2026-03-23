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
  offsetX: 3.4246,
  offsetY: -7.9429,
  rotationDeg: 0,
  scale: 1,
  scaleX: 12.9074 / 8200,
  scaleY: 8.5369 / 420,
  flipX: false,
  flipY: true,
};

export function applyTrackingCalibration(
  input: [number, number],
  calibration: TrackingCalibration
): [number, number] {
  const scaleX = calibration.scaleX ?? calibration.scale;
  const scaleY = calibration.scaleY ?? calibration.scale;
  const sourceOriginX = calibration.sourceOriginX ?? 0;
  const sourceOriginY = calibration.sourceOriginY ?? 0;
  const scaledX =
    (input[0] - sourceOriginX) *
    scaleX *
    calibration.scale *
    (calibration.flipX ? -1 : 1);
  const scaledY =
    (input[1] - sourceOriginY) *
    scaleY *
    calibration.scale *
    (calibration.flipY ? -1 : 1);
  const radians = (calibration.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const rotatedX = scaledX * cos - scaledY * sin;
  const rotatedY = scaledX * sin + scaledY * cos;

  return [
    rotatedX + calibration.offsetX,
    rotatedY + calibration.offsetY,
  ];
}
