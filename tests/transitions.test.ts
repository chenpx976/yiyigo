import test from "node:test";
import assert from "node:assert/strict";
import { Go } from "../src/engine";
import { surfaceModel } from "../src/surface-model";
import { sampleSurface, updateSurfaces } from "../src/surface-transition";
import type {
  SurfaceTransition,
  SurfaceTarget,
} from "../src/surface-transition";
import { sampleConnection } from "../src/connection-state";
import type { ConnectionState } from "../src/connection-state";
const target: SurfaceTarget = {
  i: 40,
  j: 40,
  type: 0,
  color: 1,
  lib: 4,
  seed: 0,
};
test("landing, rapid reversal and hover keep continuous geometry", () => {
  const states = new Map<string, SurfaceTransition>();
  let s = updateSurfaces([target], states, 1, true)[0];
  assert.equal(sampleSurface(s, 1), 0);
  assert.ok(Math.abs(sampleSurface(s, 1.35) - 0.5) < 1e-8);
  updateSurfaces([target], states, 1.2, false);
  assert.equal(s.start, 1, "hover does not restart or finish landing");
  s = updateSurfaces([], states, 1.35, true)[0];
  assert.ok(Math.abs(sampleSurface(s, 1.35) - 0.5) < 1e-8);
  assert.ok(sampleSurface(s, 1.6) < 0.5);
  assert.equal(updateSurfaces([], states, 2.1, false).length, 0);
});
test("capture keeps the joined surface for shrink, then removes every retired part", () => {
  const g = new Go(9);
  g.board[40] = g.board[41] = g.board[43] = 1;
  const surfaces = new Map<string, SurfaceTransition>(),
    connections = new Map<string, ConnectionState>();
  surfaceModel(g, -1, [], false, 0, false, connections, surfaces);
  const old = g.board.slice();
  g.board[40] = g.board[41] = 0;
  let m = surfaceModel(g, -1, old, true, 1, true, connections, surfaces);
  assert.equal(
    m.primitives.filter((p) => p.data[4] === 0).length,
    3,
    "captured stones are still present at transition start",
  );
  assert.ok(
    m.primitives.some(
      (p) => p.data[4] === 1 && p.data[8] === 1 && p.data[12] === 0,
    ),
    "joined root shrinks with its stones",
  );
  assert.ok(
    m.primitives.some((p) => p.data[4] === 2),
    "virtual root retires continuously too",
  );
  m = surfaceModel(g, -1, g.board, false, 2, true, connections, surfaces);
  assert.equal(m.primitives.length, 1);
});
test("virtual to solid fills without opening a false cutting gap", () => {
  const g = new Go(9);
  g.board[40] = g.board[42] = 1;
  const surfaces = new Map<string, SurfaceTransition>(),
    connections = new Map<string, ConnectionState>();
  surfaceModel(g, -1, [], false, 0, false, connections, surfaces);
  const old = g.board.slice();
  g.board[41] = 1;
  const m = surfaceModel(g, -1, old, true, 1, true, connections, surfaces);
  assert.equal(
    m.primitives.filter(
      (p) => p.data[4] === 1 && p.data[8] === 0 && p.data[12] === 1,
    ).length,
    2,
  );
  assert.ok([...connections.values()].every((s) => s.to[3] === 0));
});
test("reduced motion resolves immediately without retained captured shapes", () => {
  const states = new Map<string, SurfaceTransition>();
  assert.equal(updateSurfaces([target], states, 0, false)[0].from, 1);
  assert.equal(updateSurfaces([], states, 1, false).length, 0);
});

test('merging retains the old strand until the new real surfaces start filling',()=>{
 const g=new Go(19);g.board[180]=g.board[182]=1;
 const connections=new Map<string,ConnectionState>(),surfaces=new Map<string,SurfaceTransition>();
 surfaceModel(g,-1,[],false,0,false,connections,surfaces);
 const strength=[...connections.values()][0].to[0];
 g.board[181]=1;surfaceModel(g,-1,[],true,1,true,connections,surfaces);
 const state=[...connections.values()][0];
 assert.equal(state.merging,true);
 assert.equal(sampleConnection(state,1.1)[0],strength);
 assert.ok(sampleConnection(state,1.5)[0]<strength);
 assert.equal(sampleConnection(state,1.7)[0],0);
});
