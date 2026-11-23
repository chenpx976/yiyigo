import * as THREE from "three";
import { createImplicitStones } from "./implicit-stones";
import type { Go, Cell } from "./engine";
import { surfaceModel } from "./surface-model";
import type { SurfaceModel } from "./surface-model";
import { analyzeConnections } from "./connection-state";
import type { ConnectionState } from "./connection-state";
import type { SurfaceTransition } from "./surface-transition";
import { stoneColors } from "./stone-material";

export interface ModelSurface {
  mesh: THREE.Group;
  updateModel(n: number, model: SurfaceModel, time: number, motion: boolean): void;
  setTime(time: number): void;
  dispose(): void;
}

export interface LivingSurface extends ModelSurface {
  update(game: Go, previous: Cell[], animate: boolean, time: number, motion: boolean, focus?: number): void;
}

export function createLivingSurface(
  game: Go,
  previous: Cell[],
  animate: boolean,
  time: number,
  motion: boolean,
  connections: Map<string, ConnectionState>,
  surfaces: Map<string, SurfaceTransition>,
  focus = -1,
): LivingSurface {
  let size = game.n;
  let board = Uint8Array.from(game.board);
  let analysis = analyzeConnections(game);
  const live = createSurfaceFromModel(game.n, surfaceModel(
    game, focus, previous, animate, time, motion, connections, surfaces, undefined, analysis,
  ), time, motion);
  return {
    ...live,
    update(game, previous, animate, time, motion, focus = -1) {
      const resized = size !== game.n;
      if (resized || board.length !== game.board.length || board.some((color, i) => color !== game.board[i])) {
        if (board.length !== game.board.length) board = new Uint8Array(game.board.length);
        board.set(game.board);
        size = game.n;
        analysis = analyzeConnections(game);
      }
      live.updateModel(game.n, surfaceModel(
        game, focus, previous, animate, time, motion, connections, surfaces,
        resized ? "reset" : undefined, analysis,
      ), time, motion);
    },
  };
}

// Diagnostic atlases can render evaluated models without inventing rule links.
export function createSurfaceFromModel(n: number, model: SurfaceModel, time: number, motion: boolean): ModelSurface {
  const geometry = new THREE.BufferGeometry();
  geometry.boundingBox = new THREE.Box3();
  geometry.boundingSphere = new THREE.Sphere();
  let cellCapacity = 0;
  let positions: THREE.BufferAttribute;
  let normals: THREE.BufferAttribute;
  let points: THREE.BufferAttribute;
  let ranges: THREE.BufferAttribute;
  let indices: THREE.BufferAttribute;
  const texture = new THREE.DataTexture(new Float32Array(4096), 1024, 1, THREE.RGBAFormat, THREE.FloatType);
  const crossingTexture = new THREE.DataTexture(new Float32Array(4096), 1024, 1, THREE.RGBAFormat, THREE.FloatType);
  const uniforms = {
    uData: { value: texture },
    uCrossings: { value: crossingTexture },
    uTime: { value: time },
    uMotion: { value: motion ? 1 : 0 },
    uSpacing: { value: 660 / (n - 1) },
    uBoardSize: { value: n },
    uBlack: { value: new THREE.Color(stoneColors.black) },
    uWhite: { value: new THREE.Color(stoneColors.white) },
  };
  const implicit = createImplicitStones(geometry, uniforms);
  const group = new THREE.Group();
  group.add(implicit.mesh);
  const nodeAddresses = new Map<string, number>();
  let disposed = false;

  function textureStorage(uniform: { value: THREE.DataTexture }, floats: number): Float32Array {
    let texture = uniform.value;
    if (floats > texture.image.height * 4096) {
      let height = texture.image.height;
      while (height * 4096 < floats) height *= 2;
      // Uploaded texture dimensions are immutable; replace only on growth.
      const next = new THREE.DataTexture(new Float32Array(height * 4096), 1024, height, THREE.RGBAFormat, THREE.FloatType);
      uniform.value = next;
      texture.dispose();
      texture = next;
    }
    texture.needsUpdate = true;
    return texture.image.data as Float32Array;
  }

  function updateModel(n: number, model: SurfaceModel, time: number, motion: boolean) {
    if (disposed) throw new Error("Cannot update a disposed surface");
    const { primitives, bins } = model;
    let occupied = 0, references = 0, crossingCount = 0;
    for (const bin of bins) {
      if (bin.length) occupied++;
      references += bin.length;
    }
    for (const primitive of primitives) crossingCount += primitive.crossings?.length ?? 0;
    if (occupied > cellCapacity || cellCapacity === 0) {
      // All supported boards fit the initial allocation. If a larger diagnostic
      // model grows past it, release uploaded buffers before replacing attributes.
      if (cellCapacity) geometry.dispose();
      cellCapacity = Math.max(19 * 19, cellCapacity * 2, occupied);
      positions = new THREE.BufferAttribute(new Float32Array(cellCapacity * 12), 3).setUsage(THREE.DynamicDrawUsage);
      normals = new THREE.BufferAttribute(new Float32Array(cellCapacity * 12), 3);
      points = new THREE.BufferAttribute(new Float32Array(cellCapacity * 8), 2).setUsage(THREE.DynamicDrawUsage);
      ranges = new THREE.BufferAttribute(new Float32Array(cellCapacity * 8), 2).setUsage(THREE.DynamicDrawUsage);
      indices = new THREE.BufferAttribute(new Uint32Array(cellCapacity * 6), 1);
      for (let cell = 0; cell < cellCapacity; cell++) {
        const vertex = cell * 4;
        for (let corner = 0; corner < 4; corner++) normals.setXYZ(vertex + corner, 0, 0, 1);
        (indices.array as Uint32Array).set([vertex, vertex + 3, vertex + 1, vertex, vertex + 2, vertex + 3], cell * 6);
      }
      geometry.setAttribute("position", positions);
      geometry.setAttribute("normal", normals);
      geometry.setAttribute("aPoint", points);
      geometry.setAttribute("aRange", ranges);
      geometry.setIndex(indices);
    }
    const data = textureStorage(uniforms.uData, primitives.length * 20 + references * 4);
    const crossingData = textureStorage(uniforms.uCrossings, (primitives.length + crossingCount) * 4);
    nodeAddresses.clear();
    for (let index = 0; index < primitives.length; index++) {
      const p = primitives[index].data;
      data.set(p, index * 20);
      if (p[4] === 0) {
        const key = `${p[5]}:${p[0]}:${p[1]}`;
        if (!nodeAddresses.has(key)) nodeAddresses.set(key, index * 5);
      }
    }
    let crossingOffset = primitives.length * 4;
    for (let index = 0; index < primitives.length; index++) {
      const primitive = primitives[index], p = primitive.data;
      if (p[4] !== 0) {
        data[index * 20 + 6] = nodeAddresses.get(`${p[5]}:${p[0]}:${p[1]}`) ?? -1;
        data[index * 20 + 7] = nodeAddresses.get(`${p[5]}:${p[2]}:${p[3]}`) ?? -1;
      }
      crossingData[index * 4] = crossingOffset / 4;
      crossingData[index * 4 + 1] = primitive.crossings?.length ?? 0;
      crossingData[index * 4 + 2] = crossingData[index * 4 + 3] = 0;
      for (const c of primitive.crossings ?? []) {
        crossingData[crossingOffset++] = c.t;
        crossingData[crossingOffset++] = c.from;
        crossingData[crossingOffset++] = c.to;
        crossingData[crossingOffset++] = c.start;
      }
    }
    const spacing = 660 / (n - 1);
    let cell = 0, offset = primitives.length * 20;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      if (!bin.length) continue;
      const start = offset / 4;
      for (const p of bin) {
        data[offset++] = p * 5;
        data[offset++] = 0;
        data[offset++] = 0;
        data[offset++] = 0;
      }
      const x = i % n, y = Math.floor(i / n);
      left = Math.min(left, x - 0.5); right = Math.max(right, x + 0.5);
      top = Math.min(top, y - 0.5); bottom = Math.max(bottom, y + 0.5);
      for (let corner = 0; corner < 4; corner++) {
        const vertex = cell * 4 + corner;
        const px = x - 0.5 + corner % 2, py = y - 0.5 + Math.floor(corner / 2);
        positions.setXYZ(vertex, 50 + px * spacing, -50 - py * spacing, 0);
        points.setXY(vertex, px, py);
        ranges.setXY(vertex, start, bin.length);
      }
      cell++;
    }
    positions.needsUpdate = points.needsUpdate = ranges.needsUpdate = true;
    geometry.setDrawRange(0, occupied * 6);
    // Ignore unused capacity and include the vertex shader's elevated ray plane.
    if (occupied) {
      geometry.boundingBox!.min.set(Math.fround(50 + left * spacing), Math.fround(-50 - bottom * spacing), 0);
      geometry.boundingBox!.max.set(Math.fround(50 + right * spacing), Math.fround(-50 - top * spacing), 0.5 * spacing + 0.5);
      geometry.boundingBox!.getBoundingSphere(geometry.boundingSphere!);
    } else {
      geometry.boundingBox!.makeEmpty();
      geometry.boundingSphere!.center.set(0, 0, 0);
      geometry.boundingSphere!.radius = 0;
    }
    uniforms.uTime.value = time;
    uniforms.uMotion.value = motion ? 1 : 0;
    uniforms.uSpacing.value = spacing;
    uniforms.uBoardSize.value = n;
  }

  updateModel(n, model, time, motion);
  return {
    mesh: group,
    updateModel,
    setTime: (time: number) => { uniforms.uTime.value = time; },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      uniforms.uData.value.dispose();
      uniforms.uCrossings.value.dispose();
      implicit.material.dispose();
      implicit.depth.dispose();
    },
  };
}
