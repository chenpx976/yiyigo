import test from "node:test";
import assert from "node:assert/strict";
import { Mesh, ShaderMaterial, Vector3 } from "three";
import type { DataTexture } from "three";
import { Go } from "../src/engine";
import { createLivingSurface, createSurfaceFromModel } from "../src/living-stones";
import type { ModelSurface } from "../src/living-stones";
import { surfaceModel } from "../src/surface-model";
import type { SurfaceModel } from "../src/surface-model";
import { analyzeConnections, updateConnections, sampleVisibility } from "../src/connection-state";
import type { ConnectionState } from "../src/connection-state";
import type { SurfaceTransition } from "../src/surface-transition";

function assertPacked(live: ModelSurface, model: SurfaceModel, n: number) {
  const mesh = live.mesh.children[0] as Mesh;
  const material = mesh.material as ShaderMaterial;
  const depth = mesh.customDepthMaterial as ShaderMaterial;
  assert.equal(depth.uniforms.uData, material.uniforms.uData);
  assert.equal(depth.uniforms.uCrossings, material.uniforms.uCrossings);
  const data = (material.uniforms.uData.value as DataTexture).image.data as Float32Array;
  const crossings = (material.uniforms.uCrossings.value as DataTexture).image.data as Float32Array;
  for (const [index, primitive] of model.primitives.entries()) {
    const expected = [...primitive.data];
    if (expected[4] !== 0) {
      for (const [coordinate, address] of [[0, 6], [2, 7]]) {
        const node = model.primitives.findIndex(p => p.data[4] === 0 && p.data[5] === expected[5] &&
          p.data[0] === expected[coordinate] && p.data[1] === expected[coordinate + 1]);
        expected[address] = node < 0 ? -1 : node * 5;
      }
    }
    assert.deepEqual(data.slice(index * 20, index * 20 + 20), Float32Array.from(expected));
    assert.equal(crossings[index * 4 + 1], primitive.crossings?.length ?? 0);
    for (const [i, crossing] of (primitive.crossings ?? []).entries()) {
      const start = (crossings[index * 4] + i) * 4;
      assert.deepEqual(crossings.slice(start, start + 4), Float32Array.from([crossing.t, crossing.from, crossing.to, crossing.start]));
    }
  }
  const geometry = mesh.geometry;
  const points = geometry.getAttribute("aPoint"), ranges = geometry.getAttribute("aRange");
  let cell = 0;
  for (const [index, bin] of model.bins.entries()) {
    if (!bin.length) continue;
    for (let corner = 0; corner < 4; corner++) {
      const vertex = cell * 4 + corner;
      assert.equal(points.getX(vertex), index % n - 0.5 + corner % 2);
      assert.equal(points.getY(vertex), Math.floor(index / n) - 0.5 + Math.floor(corner / 2));
      assert.equal(ranges.getY(vertex), bin.length);
      const start = ranges.getX(vertex) * 4;
      assert.deepEqual(bin.map((_, i) => data[start + i * 4]), bin.map(p => p * 5));
      const position = new Vector3().fromBufferAttribute(geometry.getAttribute("position"), vertex);
      assert.ok(geometry.boundingBox!.containsPoint(position));
      position.z = 0.5 * 660 / (n - 1) + 0.5;
      // CPU positions are float32, whereas bounds use full precision.
      assert.ok(geometry.boundingSphere!.distanceToPoint(position) < 0.001);
    }
    cell++;
  }
  assert.equal(geometry.drawRange.count, cell * 6);
}

test("living updates retain resources and pack capture, reversal, focus and board-size changes", () => {
  const game = new Go(19);
  game.board[180] = game.board[182] = 1;
  const connections = new Map<string, ConnectionState>(), surfaces = new Map<string, SurfaceTransition>();
  const expectedConnections = new Map<string, ConnectionState>(), expectedSurfaces = new Map<string, SurfaceTransition>();
  const live = createLivingSurface(game, [], false, 0, true, connections, surfaces);
  assertPacked(live, surfaceModel(game, -1, [], false, 0, true, expectedConnections, expectedSurfaces), 19);
  const mesh = live.mesh.children[0] as Mesh, geometry = mesh.geometry, material = mesh.material as ShaderMaterial;
  const texture = material.uniforms.uData.value, data = texture.image.data;
  const positions = geometry.getAttribute("position");
  for (const [time, stone, focus] of [[1, 2, -1], [1.12, 0, 180], [1.2, 2, 182], [1.28, 0, -1]]) {
    const previous = game.board.slice();
    game.board[181] = stone as 0 | 2;
    live.update(game, previous, true, time, true, focus);
    assertPacked(live, surfaceModel(game, focus, previous, true, time, true, expectedConnections, expectedSurfaces), 19);
    assert.deepEqual([...connections], [...expectedConnections]);
    assert.deepEqual([...surfaces], [...expectedSurfaces]);
    assert.equal(live.mesh.children[0], mesh);
    assert.equal(mesh.geometry, geometry);
    assert.equal(mesh.material, material);
    assert.equal(material.uniforms.uData.value, texture);
    assert.equal(texture.image.data, data);
    assert.equal(geometry.getAttribute("position"), positions);
  }
  game.board[180] = 0;
  live.update(game, [], true, 1.4, true);
  assertPacked(live, surfaceModel(game, -1, [], true, 1.4, true, expectedConnections, expectedSurfaces), 19);
  live.update(game, [], false, 3, true);
  assertPacked(live, surfaceModel(game, -1, [], false, 3, true, expectedConnections, expectedSurfaces), 19);
  const small = new Go(9); small.board[80] = 2;
  live.update(small, [], true, 4, true);
  assertPacked(live, surfaceModel(small, -1, [], false, 4, true, new Map(), new Map()), 9);
  assert.equal(mesh.geometry, geometry);
  assert.equal(geometry.getAttribute("position"), positions);
  assert.equal(material.uniforms.uSpacing.value, 82.5);
  live.setTime(7);
  assert.equal((mesh.customDepthMaterial as ShaderMaterial).uniforms.uTime.value, 7);
  live.dispose();
});

test("focus-only updates reuse tactical group analysis without restarting stone lifecycles", () => {
  const game = new Go(19);
  for (const p of [142, 161, 199]) game.board[p] = 1;
  for (const p of [178, 179, 181]) game.board[p] = 2;
  let traversals = 0;
  const originalGroup = game.group.bind(game);
  game.group = (...args) => { traversals++; return originalGroup(...args); };
  const connections = new Map<string, ConnectionState>(), surfaces = new Map<string, SurfaceTransition>();
  const live = createLivingSurface(game, [], true, 0, true, connections, surfaces);
  const initialTraversals = traversals, bodies = structuredClone([...surfaces]);
  assert.ok(initialTraversals > 0);
  live.update(game, game.board, false, 0.1, true, 142);
  assert.equal(connections.get("1:161:199")!.toVisibility, 1);
  live.update(game, game.board, false, 0.2, true, 178);
  assert.equal(connections.get("2:179:181")!.toVisibility, 1);
  assert.ok(sampleVisibility(connections.get("1:161:199")!, 0.2) > 0);
  assert.equal(traversals, initialTraversals);
  assert.deepEqual([...surfaces], bodies);
  game.board[180] = 1;
  live.update(game, [], true, 0.3, true);
  assert.ok(traversals > initialTraversals, "in-place board changes invalidate analysis");
  live.dispose();
});

test("texture growth replaces GPU storage once, shrink reuses capacity, and disposal is exact", () => {
  const game = new Go(19); game.board[0] = 1;
  const small = surfaceModel(game, -1, [], false, 0, false, new Map());
  const live = createSurfaceFromModel(19, small, 0, false);
  const mesh = live.mesh.children[0] as Mesh, material = mesh.material as ShaderMaterial;
  const oldData = material.uniforms.uData.value as DataTexture;
  const oldCrossings = material.uniforms.uCrossings.value as DataTexture;
  let oldDataDisposed = 0, oldCrossingsDisposed = 0;
  oldData.addEventListener("dispose", () => oldDataDisposed++);
  oldCrossings.addEventListener("dispose", () => oldCrossingsDisposed++);
  game.board.fill(1);
  const large = surfaceModel(game, -1, [], false, 1, false, new Map());
  for (const primitive of large.primitives) primitive.crossings = [{ key: "test", kind: "opposed", t: 0.5, from: 0.25, to: 1, start: 1 }];
  live.updateModel(19, large, 1, false);
  assertPacked(live, large, 19);
  assert.equal(oldDataDisposed, 1); assert.equal(oldCrossingsDisposed, 1);
  const data = material.uniforms.uData.value as DataTexture, crossings = material.uniforms.uCrossings.value as DataTexture;
  assert.notEqual(data, oldData); assert.notEqual(crossings, oldCrossings);
  const dataBuffer = data.image.data, crossingBuffer = crossings.image.data;
  const geometry = mesh.geometry, position = geometry.getAttribute("position");
  live.updateModel(19, small, 2, true);
  assertPacked(live, small, 19);
  const empty = { primitives: [], bins: Array.from({ length: 81 }, () => []) };
  live.updateModel(9, empty, 3, true);
  assert.equal(geometry.drawRange.count, 0);
  assert.ok(geometry.boundingBox!.isEmpty());
  assert.equal(geometry.boundingSphere!.radius, 0);
  assert.equal(material.uniforms.uData.value, data);
  assert.equal(material.uniforms.uCrossings.value, crossings);
  assert.equal(data.image.data, dataBuffer); assert.equal(crossings.image.data, crossingBuffer);
  assert.equal(geometry.getAttribute("position"), position);
  const resources = [geometry, material, mesh.customDepthMaterial!, data, crossings];
  const disposalCounts = resources.map(() => 0);
  resources.forEach((resource, i) => resource.addEventListener("dispose", () => disposalCounts[i]++));
  live.dispose(); live.dispose();
  assert.deepEqual(disposalCounts, [1, 1, 1, 1, 1]);
  assert.equal(oldDataDisposed, 1); assert.equal(oldCrossingsDisposed, 1);
  assert.throws(() => live.updateModel(9, empty, 4, false), /disposed/);
});

test("geometry capacity growth releases old buffers while retaining the mesh and geometry", () => {
  const game = new Go(19); game.board[0] = 1;
  const initial = surfaceModel(game, -1, [], false, 0, false, new Map());
  const live = createSurfaceFromModel(19, initial, 0, false);
  const mesh = live.mesh.children[0] as Mesh, geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  let releases = 0;
  geometry.addEventListener("dispose", () => releases++);
  const wide: SurfaceModel = { primitives: initial.primitives, bins: Array.from({ length: 25 * 25 }, () => [0]) };
  live.updateModel(25, wide, 1, false);
  assert.equal(mesh.geometry, geometry);
  assert.notEqual(geometry.getAttribute("position"), position);
  assert.equal(releases, 1);
  assertPacked(live, wide, 25);
  const grown = geometry.getAttribute("position");
  live.updateModel(19, initial, 2, false);
  assert.equal(geometry.getAttribute("position"), grown);
  assert.equal(releases, 1);
  live.dispose();
  assert.equal(releases, 2);
});

test("bounds-first bins preserve exhaustive intersection order at edges and during retirement", () => {
  for (const n of [9, 13, 19]) for (const color of [1, 2] as const) {
    const game = new Go(n);
    for (const p of [0, 2, n + 3, n * 3, n * 3 + 3, n * n - 1, n * n - 4]) game.board[p] = color;
    for (const p of [n, n * 2 + 1, n * 2 + 4]) game.board[p] = (3 - color) as 1 | 2;
    const connections = new Map<string, ConnectionState>(), surfaces = new Map<string, SurfaceTransition>();
    for (const time of [0, 1, 1.2, 3]) {
      if (time === 1) game.board[0] = 0;
      const model = surfaceModel(game, -1, [], time === 1, time, true, connections, surfaces);
      for (let cell = 0; cell < n * n; cell++) {
        const x = cell % n, y = Math.floor(cell / n);
        const expected = model.primitives.flatMap((p, index) => {
          const [l, t, r, b] = p.bounds;
          return l <= x + 0.5 && r >= x - 0.5 && t <= y + 0.5 && b >= y - 0.5 ? [index] : [];
        });
        assert.deepEqual(model.bins[cell], expected, `n=${n}, time=${time}, cell=${cell}`);
      }
    }
  }
});

test("endpoint addresses follow record order and color across lifecycle replacements", () => {
  const game = new Go(9); game.board[40] = game.board[42] = 1;
  const original = surfaceModel(game, -1, [], false, 0, false, new Map());
  const live = createSurfaceFromModel(9, original, 0, false);
  const edge = original.primitives.find(p => p.data[4] === 2)!;
  const nodes = original.primitives.filter(p => p.data[4] === 0);
  assert.equal(nodes.length, 2);
  const replacement = { ...nodes[0], data: [...nodes[0].data] };
  replacement.data[5] = 2;
  const reordered: SurfaceModel = {
    primitives: [edge, replacement, nodes[1], nodes[0]],
    bins: original.bins.map(bin => bin.length ? [0, 1, 2, 3] : []),
  };
  live.updateModel(9, reordered, 1, true);
  assertPacked(live, reordered, 9);
  const material = (live.mesh.children[0] as Mesh).material as ShaderMaterial;
  const data = material.uniforms.uData.value.image.data as Float32Array;
  assert.equal(data[6], 15, "same-coordinate opposite color is not the endpoint owner");
  assert.equal(data[7], 10, "edge can precede its endpoint records");
  reordered.primitives.pop();
  reordered.bins = reordered.bins.map(bin => bin.filter(index => index < 3));
  live.updateModel(9, reordered, 2, true);
  assertPacked(live, reordered, 9);
  assert.equal(data[6], -1, "missing lifecycle owners never retain a stale address");
  live.dispose();
});

test("supplied connection analysis matches standalone updates through focus and merging", () => {
  const game = new Go(9); game.board[40] = game.board[42] = 1;
  const cached = new Map<string, ConnectionState>(), standalone = new Map<string, ConnectionState>();
  for (const [time, middle, focus] of [[0, 0, -1], [1, 0, 40], [1.1, 1, 41], [1.2, 0, -1], [3, 0, 42]]) {
    game.board[41] = middle as 0 | 1;
    const analysis = analyzeConnections(game);
    updateConnections(game, cached, time, time > 0, focus, analysis);
    updateConnections(game, standalone, time, time > 0, focus);
    assert.deepEqual([...cached], [...standalone]);
  }
});
