import test from "node:test";
import assert from "node:assert/strict";
import { Go } from "../src/engine";
import type { Color } from "../src/engine";
import { surfaceModel, surfaceUpdateMode } from "../src/surface-model";
import type { SurfacePrimitive } from "../src/surface-model";
import { sampleConnection, sampleCut, sampleVisibility } from "../src/connection-state";
import type { ConnectionState } from "../src/connection-state";
import { sampleSurface } from "../src/surface-transition";
import type { SurfaceTransition } from "../src/surface-transition";

const point = (x: number, y: number) => y * 19 + x;
const cache = () => ({ connections: new Map<string, ConnectionState>(), surfaces: new Map<string, SurfaceTransition>() });
const scene = (color: Color) => {
  const game = new Go(19), enemy = (3 - color) as Color;
  // The focus is deliberately on a solid neighbour, not on the small-jump endpoint.
  for (const [x, y] of [[9, 7], [9, 8], [9, 10], [3, 13], [3, 15]]) game.board[point(x, y)] = color;
  for (const [x, y] of [[7, 9], [8, 9], [10, 9], [2, 14], [4, 14]]) game.board[point(x, y)] = enemy;
  return {
    game, ownFocus: point(9, 7), enemyFocus: point(7, 9), emptyFocus: point(9, 9),
    ownKey: `${color}:${point(9, 8)}:${point(9, 10)}`,
    enemyKey: `${enemy}:${point(8, 9)}:${point(10, 9)}`,
    distantKey: `${color}:${point(3, 13)}:${point(3, 15)}`,
  };
};
const fixedPrimitives = (primitives: SurfacePrimitive[]) => primitives
  .filter(p => p.data[4] < 2)
  // Index 19 is the selection flag; all geometric/lifecycle inputs must stay fixed.
  .map(p => ({ data: p.data.slice(0, 19), bounds: p.bounds }));
const samples = (state: ReturnType<typeof cache>, time: number) => ({
  nodes: [...state.surfaces].map(([key, node]) => [key, {
    i: node.i, j: node.j, type: node.type, color: node.color, lib: node.lib, seed: node.seed,
    life: sampleSurface(node, time),
  }]),
  links: [...state.connections].map(([key, link]) => [key, {
    link: link.link, tone: sampleConnection(link, time), visibility: sampleVisibility(link, time),
    cut: sampleCut(link, time), crossings: link.crossings,
  }]),
});

// These tests exercise surfaceModel's same-board "sample" path. Calling the
// connection selector directly would miss focus updates lost by the integration.
test("surface focus reveals only the actual block and rapid switching settles like a clean rebuild", () => {
  for (const color of [1, 2] as const) {
    const { game, ownFocus, enemyFocus, emptyFocus, ownKey, enemyKey, distantKey } = scene(color), state = cache();
    const boardBefore = JSON.stringify(game);
    const initial = surfaceModel(game, -1, [], false, 0, true, state.connections, state.surfaces);
    const bodies = structuredClone([...state.surfaces]);
    assert.equal(state.connections.get(ownKey)!.toVisibility, 0);
    assert.equal(state.connections.get(enemyKey)!.toVisibility, 0);
    assert.equal(state.connections.get(distantKey)!.toVisibility, 0);
    const toneBefore = [...state.connections.get(ownKey)!.to];
    assert.equal(surfaceUpdateMode(game, state.surfaces, false, true), "sample");

    const focused = surfaceModel(game, ownFocus, game.board, false, 1, true, state.connections, state.surfaces);
    assert.equal(state.connections.get(ownKey)!.toVisibility, 1);
    assert.equal(state.connections.get(enemyKey)!.toVisibility, 0);
    assert.equal(state.connections.get(distantKey)!.toVisibility, 0, "focus never reveals a distant same-color block");
    assert.equal(sampleVisibility(state.connections.get(ownKey)!, 1), 0);
    assert.deepEqual(state.connections.get(ownKey)!.to, toneBefore, "display focus does not upgrade tactical strength");
    assert.deepEqual(fixedPrimitives(focused.primitives), fixedPrimitives(initial.primitives));
    const packedLink = focused.primitives.find(p => p.data[4] === 2 && p.data[5] === color && p.data[0] === 9 && p.data[1] === 8 && p.data[2] === 9 && p.data[3] === 10)!;
    assert.equal(packedLink.data[10], 0, "GPU visibility starts at the currently hidden state");
    assert.equal(packedLink.data[14], 1, "GPU target receives focus visibility");

    // Moving focus within the same real block must not restart the reveal clock.
    const clocks = new Map([...state.connections].map(([key, link]) => [key, link.start]));
    surfaceModel(game, point(9, 8), game.board, false, 1.1, true, state.connections, state.surfaces);
    for (const [key, link] of state.connections) assert.equal(link.start, clocks.get(key));
    assert.ok(sampleVisibility(state.connections.get(ownKey)!, 1.1) > 0);
    assert.ok(sampleVisibility(state.connections.get(ownKey)!, 1.1) < 1);

    for (const [time, focus] of [[1.16, enemyFocus], [1.22, ownFocus], [1.27, -1], [1.3, emptyFocus], [1.34, -1]]) {
      const before = new Map([...state.connections].map(([key, link]) => [key, {
        tone: sampleConnection(link, time), visibility: sampleVisibility(link, time),
        target: link.toVisibility, start: link.start,
      }]));
      const model = surfaceModel(game, focus, game.board, false, time, true, state.connections, state.surfaces);
      for (const [key, link] of state.connections) {
        assert.deepEqual(sampleConnection(link, time), before.get(key)!.tone);
        assert.equal(sampleVisibility(link, time), before.get(key)!.visibility);
        if (link.toVisibility === before.get(key)!.target) assert.equal(link.start, before.get(key)!.start);
        assert.equal(link.to[3], 0, "focus suppression never opens a tactical cut");
        assert.deepEqual(link.crossings, [], "focus never manufactures intersection fragments");
      }
      assert.deepEqual([...state.surfaces], bodies);
      assert.deepEqual(fixedPrimitives(model.primitives), fixedPrimitives(initial.primitives));
      assert.equal(game.board[emptyFocus], 0);
      assert.equal(state.connections.get(distantKey)!.toVisibility, 0);
    }
    const settled = surfaceModel(game, -1, game.board, false, 3, true, state.connections, state.surfaces);
    const clean = cache(), rebuilt = surfaceModel(game, -1, [], false, 3, true, clean.connections, clean.surfaces);
    assert.deepEqual(samples(state, 3), samples(clean, 3), "no stale material survives repeated focus reversals");
    assert.equal(settled.primitives.length, rebuilt.primitives.length);
    assert.ok([...state.connections.values()].every(link => sampleVisibility(link, 3) === 0));
    assert.deepEqual([...state.surfaces], bodies);
    assert.equal(JSON.stringify(game), boardBefore);
  }
});

test("focus changes during landing preserve all stone and solid-link lifecycle origins", () => {
  for (const color of [1, 2] as const) {
    const { game, ownFocus, enemyFocus } = scene(color), state = cache();
    surfaceModel(game, -1, [], true, 0, true, state.connections, state.surfaces);
    const bodies = structuredClone([...state.surfaces]);
    assert.ok(bodies.some(([, node]) => node.type === 1), "the scene includes solid links as well as stone bodies");
    assert.ok(bodies.every(([, node]) => node.from === 0 && node.to === 1 && node.start === 0));
    for (const [time, focus] of [[.08, ownFocus], [.16, enemyFocus], [.24, -1], [.32, ownFocus], [.8, -1]]) {
      const lives = new Map([...state.surfaces].map(([key, node]) => [key, sampleSurface(node, time)]));
      assert.equal(surfaceUpdateMode(game, state.surfaces, false, true), "sample");
      surfaceModel(game, focus, game.board, false, time, true, state.connections, state.surfaces);
      assert.deepEqual([...state.surfaces], bodies);
      for (const [key, node] of state.surfaces) assert.equal(sampleSurface(node, time), lives.get(key));
    }
    assert.ok([...state.surfaces.values()].every(node => sampleSurface(node, .8) === 1));
  }
});

test("initial focus and reduced-motion focus resolve immediately through the reset path", () => {
  for (const color of [1, 2] as const) {
    const { game, ownFocus, enemyFocus, emptyFocus, ownKey, enemyKey } = scene(color), state = cache();
    surfaceModel(game, ownFocus, [], false, 0, true, state.connections, state.surfaces);
    assert.equal(sampleVisibility(state.connections.get(ownKey)!, 0), 1);
    assert.equal(sampleVisibility(state.connections.get(enemyKey)!, 0), 0);
    surfaceModel(game, enemyFocus, game.board, false, .1, false, state.connections, state.surfaces);
    assert.equal(sampleVisibility(state.connections.get(ownKey)!, .1), 0);
    assert.equal(sampleVisibility(state.connections.get(enemyKey)!, .1), 1);
    surfaceModel(game, emptyFocus, game.board, false, .2, false, state.connections, state.surfaces);
    assert.ok([...state.connections.values()].every(link => sampleVisibility(link, .2) === 0));
    assert.ok([...state.surfaces.values()].every(node => sampleSurface(node, .2) === 1));
  }
});
