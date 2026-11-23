import * as THREE from "three";
import { createImplicitStones } from "./implicit-stones";
import type { Go, Cell } from "./engine";
import { surfaceModel } from "./surface-model";

import type { ConnectionState } from "./connection-state";
import { type SurfaceTransition } from "./surface-transition";
import { stoneColors } from "./stone-material";

export function createLivingSurface(
  game: Go,
  previous: Cell[],
  animate: boolean,
  time: number,
  motion: boolean,
  connections: Map<string, ConnectionState>,
  surfaces: Map<string, SurfaceTransition>,
  envelopePrototype = false,
  focus = -1,
) {
  const { primitives, bins } = surfaceModel(
    game,
    focus,
    previous,
    animate,
    time,
    motion,
    connections,
    surfaces,
  );
  return createSurfaceFromModel(game.n,{primitives,bins},time,motion);
}

// Render an already evaluated model. Diagnostic atlases can compose independent
// cases without inventing rule relationships between neighbouring examples.
export function createSurfaceFromModel(n:number,model:ReturnType<typeof surfaceModel>,time:number,motion:boolean){
  const {primitives,bins}=model;
  const values = primitives.flatMap((p) => p.data),
    positions: number[] = [],
    points: number[] = [],
    ranges: number[] = [],
    indices: number[] = [],
    normals: number[] = [];
  // Link metadata contains both node record addresses. The shader evaluates
  // each whole link once and samples endpoint lifecycle from these references.
  for (let index=0;index<primitives.length;index++) {
    const link=primitives[index];if(link.data[4]===0)continue;
    const [ax,ay,bx,by]=link.data,color=link.data[5];
    const findNode=(x:number,y:number)=>primitives.findIndex(p=>p.data[4]===0&&p.data[5]===color&&p.data[0]===x&&p.data[1]===y);
    const a=findNode(ax,ay),b=findNode(bx,by);
    values[index*20+6]=a<0?-1:a*5;
    values[index*20+7]=b<0?-1:b*5;
  }
  const s = 660 / (n - 1),
    divisions = 1;
  for (let i = 0; i < bins.length; i++) {
    if (!bins[i].length) continue;
    const start = values.length / 4;
    for (const p of bins[i]) values.push(p * 5, 0, 0, 0);
    const x = i % n,
      y = Math.floor(i / n),
      offset = points.length / 2;
    for (let row = 0; row <= divisions; row++)
      for (let col = 0; col <= divisions; col++) {
        const px = x - 0.5 + col / divisions,
          py = y - 0.5 + row / divisions;
        points.push(px, py);
        positions.push(50 + px * s, -50 - py * s, 0);
        normals.push(0, 0, 1);
        ranges.push(start, bins[i].length);
      }
    for (let row = 0; row < divisions; row++)
      for (let col = 0; col < divisions; col++) {
        const p = offset + row * (divisions + 1) + col;
        indices.push(
          p,
          p + divisions + 2,
          p + 1,
          p,
          p + divisions + 1,
          p + divisions + 2,
        );
      }
  }
  const height = Math.max(1, Math.ceil(values.length / 4096)),
    data = new Float32Array(height * 4096);
  data.set(values);
  const texture = new THREE.DataTexture(
    data,
    1024,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.needsUpdate = true;
  // Separate side table leaves the existing five-vec4 stone/edge records intact.
  // Header index = edge record address / 5. Header.xy = start texel, count.
  // Each appended crossing texel is [relative t, from amount, to amount, start].
  const crossingValues = new Array<number>(primitives.length * 4).fill(0);
  primitives.forEach((primitive, index) => {
    const crossings = primitive.crossings ?? [];
    crossingValues[index * 4] = crossingValues.length / 4;
    crossingValues[index * 4 + 1] = crossings.length;
    for (const c of crossings) crossingValues.push(c.t, c.from, c.to, c.start);
  });
  const crossingHeight = Math.max(1, Math.ceil(crossingValues.length / 4096));
  const crossingData = new Float32Array(crossingHeight * 4096);
  crossingData.set(crossingValues);
  const crossingTexture = new THREE.DataTexture(crossingData, 1024, crossingHeight, THREE.RGBAFormat, THREE.FloatType);
  crossingTexture.needsUpdate = true;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("aPoint", new THREE.Float32BufferAttribute(points, 2));
  geometry.setAttribute("aRange", new THREE.Float32BufferAttribute(ranges, 2));
  geometry.setIndex(indices);
  const uniforms = {
    uData: { value: texture },
    uCrossings: { value: crossingTexture },
    // The former prototype switch is accepted only for caller compatibility.
    // All rendering now uses the single whole-edge field.
    uTime: { value: time },
    uMotion: { value: motion ? 1 : 0 },
    uSpacing: { value: s },
    uBoardSize: { value: n },
    uBlack: { value: new THREE.Color(stoneColors.black) },
    uWhite: { value: new THREE.Color(stoneColors.white) },
  };
  const implicit = createImplicitStones(geometry, uniforms);
  const group = new THREE.Group();
  group.add(implicit.mesh);
  return {
    mesh: group,
    setTime: (t: number) => { uniforms.uTime.value = t; },
    dispose: () => {
      geometry.dispose();
      texture.dispose();
      crossingTexture.dispose();
      implicit.material.dispose();
      implicit.depth.dispose();
    },
  };
}
export type LivingSurface = ReturnType<typeof createLivingSurface>;
