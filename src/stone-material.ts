import { Color, MeshPhysicalMaterial } from 'three';

// A single opaque dielectric finish for crowns and roots: satin stone,
// with no clear coating, transmission, coloured sheen or painted highlights.
export const stoneColors = Object.freeze({ black: 0x30312f, white: 0xe8e7e0 });
export function createStoneMaterial(color: number | Color = 0xffffff) {
  return new MeshPhysicalMaterial({
    color,
    roughness: .36,
    metalness: 0,
    ior: 1.48,
    specularIntensity: .38,
    clearcoat: 0,
    transmission: 0,
  });
}
