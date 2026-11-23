import test from "node:test";
import assert from "node:assert/strict";
import { Go, links } from "../src/engine";
import type { Color } from "../src/engine";
import { connectionKey, hiddenConnections, opposedCrossings } from "../src/connection-presentation";
import { connectionTone, sampleConnection, sampleVisibility, updateConnections } from "../src/connection-state";
import type { ConnectionState } from "../src/connection-state";

const point = (x: number, y: number) => y * 19 + x;
function crossed(color: Color = 1, complete = true) {
  const game = new Go(19);
  game.board[point(9, 8)] = game.board[point(9, 10)] = color;
  game.board[point(8, 9)] = (3 - color) as Color;
  if (complete) game.board[point(10, 9)] = (3 - color) as Color;
  return game;
}

test("opposed virtual crossings both yield without tactical cuts, extra stones or pinched stubs", () => {
  for (const color of [1, 2] as const) {
    const game = crossed(color), states = new Map<string, ConnectionState>();
    const before = [...game.board];
    updateConnections(game, states, 0, false);
    assert.equal(states.size, 2);
    assert.equal(links(game).length, 2);
    for (const state of states.values()) {
      assert.equal(state.to[3], 0);
      assert.ok(state.to[0] > 0, "display suppression retains tactical strength");
      assert.equal(state.toVisibility, 0);
      assert.deepEqual(state.crossings, []);
      assert.equal(game.group(state.link.i).stones.size, 1);
      assert.equal(game.group(state.link.i).liberties.size, 4);
    }
    assert.deepEqual(game.board, before);
    assert.equal(game.board[point(9, 9)], 0);
    updateConnections(game, states, 20, true);
    assert.equal(states.size, 2, "suppressed active links stay cached for restoration");
  }
});

test("competition detection keeps distinct strict crossings and ignores same-colour candidates", () => {
  const game = new Go(19);
  game.board[point(5, 4)] = game.board[point(5, 7)] = 1;
  for (const [x, y] of [[4, 5], [6, 5], [4, 6], [6, 6]]) game.board[point(x, y)] = 2;
  const candidates = links(game).filter(l => l.kind === "small" || l.kind === "large");
  const long = candidates.find(l => l.kind === "large")!;
  assert.deepEqual(opposedCrossings(game, candidates).get(long)!.map(c => c.t), [1 / 3, 2 / 3]);
  const same = crossed();
  same.board = same.board.map(c => c ? 1 : 0);
  assert.equal(opposedCrossings(same, links(same)).size, 0);
});

test("focusing any stone in the actual block reveals only its local competing contacts", () => {
  for (const color of [1, 2] as const) {
    const game = crossed(color), states = new Map<string, ConnectionState>();
    game.board[point(9, 7)] = color;
    game.board[point(2, 2)] = game.board[point(4, 2)] = (3 - color) as Color;
    game.board[point(14, 14)] = game.board[point(16, 14)] = color;
    updateConnections(game, states, 0, false, point(9, 7));
    assert.equal(states.get(`${color}:${point(9, 8)}:${point(9, 10)}`)!.toVisibility, 1);
    assert.equal(states.get(`${3 - color}:${point(8, 9)}:${point(10, 9)}`)!.toVisibility, 0);
    assert.equal(states.get(`${3 - color}:${point(2, 2)}:${point(4, 2)}`)!.toVisibility, 1);
    assert.equal(states.get(`${color}:${point(14, 14)}:${point(16, 14)}`)!.toVisibility, 1);
    for (const state of states.values()) assert.equal(state.to[3], 0);
  }
});

test("crossing appearance and fast undo retarget visibility continuously without changing strength", () => {
  for (const color of [1, 2] as const) {
    const game = crossed(color, false), states = new Map<string, ConnectionState>();
    const key = `${color}:${point(9, 8)}:${point(9, 10)}`;
    updateConnections(game, states, 0, false);
    for (let step = 0; step < 12; step++) {
      const time = 1 + step * 0.05;
      const amount = sampleVisibility(states.get(key)!, time);
      const tone = sampleConnection(states.get(key)!, time);
      if (step % 2 === 0) assert.equal(game.play(point(10, 9), (3 - color) as Color), null);
      else game.undo();
      updateConnections(game, states, time, true);
      const next = states.get(key)!;
      assert.equal(sampleVisibility(next, time), amount);
      assert.deepEqual(sampleConnection(next, time), tone);
      assert.equal(next.toVisibility, step % 2 === 0 ? 0 : 1);
      assert.ok(next.to[0] > 0);
      assert.equal(next.to[3], 0);
      assert.deepEqual(next.crossings, []);
    }
    updateConnections(game, states, 3, true);
    assert.equal(states.size, 1, "the removed opponent strand leaves no residual state");
    assert.equal(sampleVisibility(states.get(key)!, 3), 1);
  }
});

test("rapid focus switches preserve current visibility and do not retarget tactical gaps", () => {
  const game = crossed(), states = new Map<string, ConnectionState>();
  updateConnections(game, states, 0, false);
  const strengths = new Map([...states].map(([key, state]) => [key, state.to[0]]));
  for (let step = 0; step < 12; step++) {
    const time = 1 + step * 0.05, color = step % 2 + 1;
    const prior = new Map([...states].map(([key, state]) => [key, sampleVisibility(state, time)]));
    updateConnections(game, states, time, true, color === 1 ? point(9, 8) : point(8, 9));
    for (const [key, state] of states) {
      assert.equal(sampleVisibility(state, time), prior.get(key));
      assert.equal(state.toVisibility, Number(state.link.color === color));
      assert.equal(state.to[0], strengths.get(key));
      assert.equal(state.to[3], 0);
    }
  }
  updateConnections(game, states, 2, false, point(9, 9));
  for (const state of states.values()) {
    assert.equal(sampleVisibility(state, 2), 0, "an empty focus restores the quiet default immediately");
    assert.ok(state.to[0] > 0);
  }
});

test("crossing visibility is invariant under rotations, reflections and candidate iteration order", () => {
  for (const color of [1, 2] as const) {
    const game = crossed(color), states = new Map<string, ConnectionState>();
    const focus = point(9, 8);
    updateConnections(game, states, 0, false, focus);
    const candidates = links(game), strength = (link: typeof candidates[number]) => connectionTone(game, link)[0];
    const keys = (set: Set<typeof candidates[number]>) => [...set].map(connectionKey).sort();
    assert.deepEqual(keys(hiddenConnections(game, candidates, strength, focus)),
      keys(hiddenConnections(game, [...candidates].reverse(), strength, focus)));
    for (let transform = 0; transform < 8; transform++) {
      const map = (i: number) => {
        let x = i % 19, y = Math.floor(i / 19);
        if (transform >= 4) x = 18 - x;
        for (let r = 0; r < transform % 4; r++) [x, y] = [18 - y, x];
        return point(x, y);
      };
      const other = new Go(19), actual = new Map<string, ConnectionState>();
      game.board.forEach((c, i) => other.board[map(i)] = c);
      updateConnections(other, actual, 0, false, map(focus));
      for (const original of states.values()) {
        const a = map(original.link.i), b = map(original.link.j);
        const transformed = { ...original.link, i: Math.min(a, b), j: Math.max(a, b) };
        const result = actual.get(connectionKey(transformed))!;
        assert.deepEqual(result.to, original.to);
        assert.equal(result.toVisibility, original.toVisibility);
      }
    }
  }
});
