import test from "node:test";
import assert from "node:assert/strict";
import { Go, links } from "../src/engine";
import {
  connectionTone,
  updateConnections,
  sampleConnection,
  sampleVisibility,
} from "../src/connection-state";
import type { ConnectionState } from "../src/connection-state";
function pair(i: number, j: number) {
  const g = new Go(9);
  g.board[i] = g.board[j] = 1;
  return g;
}
test("quiet diagonal, small jump, knight and large jump have distinct presentation strength", () => {
  const strengths = [
    [40, 50],
    [40, 42],
    [40, 51],
    [40, 43],
  ].map(([i, j]) => {
    const g = pair(i, j);
    return connectionTone(g, links(g)[0])[0];
  });
  assert.ok(strengths[0] > strengths[1] && strengths[1] > strengths[2] && strengths[2] > strengths[3]);
});
test("atari weakens a virtual connection without merging liberties", () => {
  const g = pair(40, 42),
    before = connectionTone(g, links(g)[0]);
  for (const p of [31, 39, 49]) g.board[p] = 2;
  const link = links(g).find((l) => l.i === 40 && l.j === 42)!;
  assert.equal(g.group(40).liberties.size, 1);
  assert.equal(g.group(40).stones.size, 1);
  const after = connectionTone(g, link);
  assert.ok(after[0] < before[0]);
  assert.equal(after[1], 1);
});
test("cut jump opens at the intrusion, fades continuously, and expires", () => {
  const g = pair(40, 43),
    states = new Map<string, ConnectionState>();
  updateConnections(g, states, 0, false);
  const before = [...states.values()][0].to[0];
  g.board[41] = 2;
  const state = updateConnections(g, states, 1, true)[0];
  assert.equal(state.cut, 1 / 3);
  assert.equal(sampleConnection(state, 1)[0], before);
  assert.ok(
    sampleConnection(state, 1.35)[0] > 0 &&
      sampleConnection(state, 1.35)[0] < before,
  );
  assert.ok(sampleConnection(state, 1.35)[3] > 0);
  assert.equal(updateConnections(g, states, 2, true).length, 0);
});
test("one diagonal cut threatens, both remove the potential link", () => {
  const g = pair(40, 50);
  g.board[41] = 2;
  const link = links(g).find((l) => l.i === 40 && l.j === 50)!;
  assert.ok(link.threatened);
  assert.ok(connectionTone(g, link)[2] > 0);
  assert.equal(connectionTone(g, link)[3],0);
  g.board[49] = 2;
  assert.equal(links(g).filter((l) => l.i === 40 && l.j === 50).length, 0);
});

test('four-way layout hides only redundant weaker jumps, never rule-level links',()=>{
 for(const color of [1,2] as const){
  const g=new Go(19);for(const p of [161,179,181,199])g.board[p]=color;
  const states=new Map<string,ConnectionState>();updateConnections(g,states,0,false);
  assert.equal(links(g).length,6);
  assert.equal([...states.values()].filter(s=>s.toVisibility===1).length,4);
  assert.ok([...states.values()].filter(s=>s.toVisibility===1).every(s=>s.link.kind==='diagonal'));
  assert.ok([...states.values()].filter(s=>s.toVisibility===0).every(s=>s.link.kind==='small'&&s.to[3]===0));
  for(const p of [161,179,181,199])assert.equal(g.group(p).stones.size,1);
 }
});
test('a threatened alternate path restores its jump continuously, including fast undo',()=>{
 for(const color of [1,2] as const){
  const g=new Go(19);for(const p of [161,181,199])g.board[p]=color;
  const states=new Map<string,ConnectionState>(),key=`${color}:161:199`;
  updateConnections(g,states,0,false);assert.equal(states.get(key)!.toVisibility,0);
  assert.equal(g.play(162,(3-color) as 1|2),null);updateConnections(g,states,1,true);
  let state=states.get(key)!;assert.equal(state.toVisibility,1);assert.equal(sampleVisibility(state,1),0);
  const visible=sampleConnection(state,1.2),visibility=sampleVisibility(state,1.2);assert.ok(visibility>0);
  g.undo();updateConnections(g,states,1.2,true);state=states.get(key)!;
  assert.deepEqual(sampleConnection(state,1.2),visible);assert.equal(sampleVisibility(state,1.2),visibility);assert.equal(state.toVisibility,0);assert.equal(state.to[3],0);
  assert.equal(sampleVisibility(state,2),0);assert.ok(sampleConnection(state,2)[0]>0);
 }
});


test("knight pressure and cut restoration use integer intersections and finite continuous state", () => {
  for (const color of [1, 2] as const) {
    const game = new Go(19), i = 5 * 19 + 5, j = 6 * 19 + 7;
    game.board[i] = game.board[j] = color;
    const states = new Map<string, ConnectionState>(), key = `${color}:${i}:${j}`;
    updateConnections(game, states, 0, false);
    const initial = states.get(key)!;
    assert.equal(initial.link.kind, "knight");
    assert.equal(initial.toVisibility, 0);
    assert.ok(initial.to[0] > 0, "unproven knight stays cached with its tactical tone");
    assert.ok(initial.to.every(Number.isFinite));
    game.board[5 * 19 + 6] = (3 - color) as 1 | 2;
    updateConnections(game, states, 1, true);
    assert.ok(states.get(key)!.to[2] > 0);
    assert.equal(states.get(key)!.to[3], 0);
    assert.equal(states.get(key)!.toVisibility, 0);
    game.board[6 * 19 + 5] = (3 - color) as 1 | 2;
    updateConnections(game, states, 1.2, true);
    assert.equal(states.get(key)!.to[3], 1);
    assert.equal(states.get(key)!.cut, 2 / 5);
    const tone = sampleConnection(states.get(key)!, 1.3), visibility = sampleVisibility(states.get(key)!, 1.3);
    game.board[5 * 19 + 6] = game.board[6 * 19 + 5] = 0;
    updateConnections(game, states, 1.3, true);
    assert.deepEqual(sampleConnection(states.get(key)!, 1.3), tone);
    assert.equal(sampleVisibility(states.get(key)!, 1.3), visibility);
    assert.equal(states.get(key)!.to[3], 0);
    assert.ok(states.get(key)!.to.every(Number.isFinite));
  }
});
