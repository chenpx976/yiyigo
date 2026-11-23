import * as THREE from "three";
import { createStoneMaterial, stoneColors } from "./stone-material";
import {RoundedBoxGeometry} from "three/addons/geometries/RoundedBoxGeometry.js";
export function woodTexture(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "rgba(42,28,15,.035)";
  ctx.lineWidth = 0.6;
  for (let y = 0; y < 512; y += 3.5) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 10)
      ctx.lineTo(x, y + Math.sin(x * 0.025 + y) * 1.4);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
export function createTableScene() {
  const scene = new THREE.Group(),
    textures: THREE.Texture[] = [];
  const tableMap = woodTexture("#51443b"),
    boardMap = woodTexture("#d7b780");
  textures.push(tableMap, boardMap);
  const table = new THREE.Mesh(
    new RoundedBoxGeometry(992, 916, 26, 4, 6),
    new THREE.MeshStandardMaterial({ map: tableMap, roughness: 0.76 }),
  );
  table.position.set(380, -376, -37);
  table.receiveShadow = true;
  table.castShadow = true;
  scene.add(table);
  const board = new THREE.Mesh(
    new RoundedBoxGeometry(752, 752, 24, 4, 4),
    new THREE.MeshStandardMaterial({ map: boardMap, roughness: 0.62 }),
  );
  board.position.set(380, -380, -12);
  board.receiveShadow = true;
  board.castShadow = true;
  scene.add(board);
  const bowlMat = new THREE.MeshStandardMaterial({
    color: 0x493428,
    roughness: 0.42,
  });
  const black = createStoneMaterial(stoneColors.black),
    white = createStoneMaterial(stoneColors.white);
  const profile = [
    [0, 2],
    [30, 2],
    [51, 12],
    [60, 30],
    [61, 43],
    [58, 49],
    [53, 47],
    [51, 39],
    [44, 19],
    [22, 12],
    [0, 12],
  ].map(([r, z]) => new THREE.Vector2(r, z));
  for (const [x, y, w] of [
    [-54, 510, 0],
    [814, 244, 1],
  ]) {
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), bowlMat);
    bowl.rotation.x = Math.PI / 2;
    bowl.position.set(x, -y, -24);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    scene.add(bowl);
    [
      [0, 0],
      [23, 0],
      [-23, 0],
      [12, 22],
      [-13, 22],
      [12, -22],
      [-13, -22],
      [34, 21],
      [-34, 19],
      [31, -21],
      [-34, -20],
      [0, 38],
      [0, -38],
    ].forEach(([dx, dy], i) => {
      const stone = new THREE.Mesh(
        new THREE.SphereGeometry(11, 24, 16),
        w ? white : black,
      );
      stone.scale.z = 0.43;
      stone.rotation.x = ((i % 3) - 1) * 0.12;
      stone.position.set(x + dx, -y - dy, 6 + (i % 3) * 3);
      stone.castShadow = true;
      stone.receiveShadow = true;
      scene.add(stone);
    });
  }
  return { scene, textures };
}
export function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  object.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        materials.add(m);
    } else if (o instanceof THREE.Sprite) {
      materials.add(o.material);
    }
    if (o instanceof THREE.DirectionalLight) o.shadow.dispose();
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  object.removeFromParent();
}
