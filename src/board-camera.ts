// True top-down orthographic camera. Stone height never displaces its grid position.
export const cameraCos = 1;
export const cameraSin = Math.sqrt(1 - cameraCos * cameraCos);
export const cameraRise = cameraSin / cameraCos;
export function projectBoard(x: number, y: number, z = 0): [number, number] {
  return [x, 380 + (y - 380) * cameraCos - z * cameraSin];
}
export function unprojectBoard(x: number, y: number): [number, number] {
  return [x, 380 + (y - 380) / cameraCos];
}

export const sceneWidth = 1000;
export const sceneHeight = 960;
export const sceneOffsetX = 120;
export function scenePoint(x: number, y: number, z = 0): [number, number] {
  return [
    x + sceneOffsetX,
    sceneHeight / 2 + (y - 380) * cameraCos - z * cameraSin,
  ];
}
