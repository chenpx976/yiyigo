import test from "node:test";
import assert from "node:assert/strict";
import { Go, links } from "../src/engine";
import type { Color, Link } from "../src/engine";
import { redundantJumps } from "../src/connection-presentation";
import { updateConnections, sampleConnection, sampleVisibility } from "../src/connection-state";
import type { ConnectionState } from "../src/connection-state";

const point = (x: number, y: number) => y * 19 + x;
function scene(color: Color, coordinates: number[][]) {
  const game = new Go(19);
  for (const [x, y] of coordinates) game.board[point(x, y)] = color;
  return game;
}
function stateFor(game: Go, i: number, j: number, states = new Map<string, ConnectionState>()) {
  updateConnections(game, states, 0, false);
  return states.get(`${game.board[i]}:${Math.min(i, j)}:${Math.max(i, j)}`)!;
}

test("a local diagonal reached by solid stones retires only its redundant jump", () => {
  for (const color of [1, 2] as const) {
    const game = scene(color, [[5, 5], [7, 5], [7, 6], [6, 6]]);
    const before = JSON.stringify(game), i = point(5, 5), j = point(7, 5);
    const states = new Map<string, ConnectionState>();
    assert.equal(stateFor(game, i, j, states).toVisibility, 0);
    assert.ok(states.get(`${color}:${i}:${j}`)!.to[0] > 0, "hiding does not erase tactical strength");
    assert.ok(links(game).some(l => l.i === i && l.j === j && l.kind === "small"));
    assert.equal([...states.values()].filter(s => s.toVisibility === 1).length, 1);
    assert.equal(JSON.stringify(game), before);
    assert.equal(game.group(i).stones.has(j), false);
  }
});

test("pressure on the alternate diagonal restores the local jump and fast undo is continuous", () => {
  for (const color of [1, 2] as const) {
    const game = scene(color, [[5, 5], [7, 5], [7, 6], [6, 6]]);
    const states = new Map<string, ConnectionState>(), i = point(5, 5), j = point(7, 5);
    const key = `${color}:${i}:${j}`;
    stateFor(game, i, j, states);
    assert.equal(states.get(key)!.toVisibility, 0);
    assert.equal(game.play(point(5, 6), (3 - color) as Color), null);
    updateConnections(game, states, 1, true);
    assert.equal(states.get(key)!.toVisibility, 1);
    assert.ok(states.get(key)!.to[0] > 0);
    assert.equal(sampleVisibility(states.get(key)!, 1), 0);
    const tone = sampleConnection(states.get(key)!, 1.2);
    const visibility = sampleVisibility(states.get(key)!, 1.2);
    game.undo();
    updateConnections(game, states, 1.2, true);
    assert.deepEqual(sampleConnection(states.get(key)!, 1.2), tone);
    assert.equal(sampleVisibility(states.get(key)!, 1.2), visibility);
    assert.equal(states.get(key)!.toVisibility, 0);
    assert.equal(states.get(key)!.to[3], 0);
  }
});

test("parallel local routes and distant contacts between the same groups remain visible", () => {
  for (const color of [1, 2] as const) {
    const parallel = scene(color, [[5, 5], [5, 6], [7, 5], [7, 6]]);
    assert.ok(stateFor(parallel, point(5, 5), point(7, 5)).toVisibility === 1);
    assert.ok(stateFor(parallel, point(5, 6), point(7, 6)).toVisibility === 1);
    const coordinates: number[][] = [[6, 10], [7, 10]];
    for (let y = 5; y <= 9; y++) coordinates.push([5, y], [7, y]);
    const distant = scene(color, coordinates);
    assert.ok(links(distant).some(l => l.kind === "diagonal"));
    assert.ok(stateFor(distant, point(5, 5), point(7, 5)).toVisibility === 1);
  }
});

test("local presentation selection is invariant under all board rotations and reflections", () => {
  for (const color of [1, 2] as const) {
    const game = scene(color, [[5, 5], [7, 5], [7, 6], [6, 6]]);
    const states = new Map<string, ConnectionState>();
    updateConnections(game, states, 0, false);
    for (let transform = 0; transform < 8; transform++) {
      const map = (i: number) => {
        let x = i % 19, y = Math.floor(i / 19);
        if (transform >= 4) x = 18 - x;
        for (let r = 0; r < transform % 4; r++) [x, y] = [18 - y, x];
        return point(x, y);
      };
      const other = new Go(19);
      game.board.forEach((c, i) => other.board[map(i)] = c);
      const actual = new Map<string, ConnectionState>();
      updateConnections(other, actual, 0, false);
      for (const original of states.values()) {
        const a = map(original.link.i), b = map(original.link.j);
        const result = actual.get(`${color}:${Math.min(a, b)}:${Math.max(a, b)}`)!;
        assert.deepEqual(result.to, original.to);
        assert.equal(result.toVisibility, original.toVisibility);
      }
    }
  }
});

test("large jumps retire behind a nearer diagonal or small jump in their local corridor", () => {
  for (const color of [1, 2] as const) {
    const diagonal = scene(color, [[5, 5], [5, 8], [6, 8], [6, 7], [6, 6]]);
    assert.equal(stateFor(diagonal, point(5, 5), point(5, 8)).toVisibility, 0);
    const small = scene(color, [[5, 5], [5, 6], [7, 6], [8, 6], [8, 5]]);
    assert.equal(stateFor(small, point(5, 5), point(8, 5)).toVisibility, 0);
    assert.ok(stateFor(small, point(5, 6), point(7, 6)).toVisibility === 1);
  }
});


test("focusing an actual block restores its redundant candidates without changing strengths", () => {
  for (const color of [1, 2] as const) {
    const game = scene(color, [[5, 5], [7, 5], [7, 6], [6, 6]]);
    const states = new Map<string, ConnectionState>(), i = point(5, 5), j = point(7, 5);
    const key = `${color}:${i}:${j}`;
    updateConnections(game, states, 0, false);
    const tone = [...states.get(key)!.to];
    assert.equal(states.get(key)!.toVisibility, 0);
    updateConnections(game, states, 1, true, point(7, 6));
    assert.equal(states.get(key)!.toVisibility, 1);
    assert.equal(sampleVisibility(states.get(key)!, 1), 0);
    assert.deepEqual(states.get(key)!.to, tone);
    updateConnections(game, states, 1.2, true, -1);
    assert.equal(states.get(key)!.toVisibility, 0);
    assert.ok(sampleVisibility(states.get(key)!, 1.2) > 0);
    assert.equal(states.get(key)!.to[3], 0);
  }
});

test("nearby enemies and atari weaken isolated candidates without hiding them", () => {
  for (const color of [1, 2] as const) {
    const game = scene(color, [[5, 5], [7, 5]]);
    for (const [x, y] of [[4, 5], [5, 4], [5, 6]]) game.board[point(x, y)] = (3 - color) as Color;
    const state = stateFor(game, point(5, 5), point(7, 5));
    assert.equal(game.group(point(5, 5)).liberties.size, 1);
    assert.equal(state.to[1], 1);
    assert.equal(state.toVisibility, 1);
    assert.ok(state.to[0] > 0);
  }
});


test("knight relations are hidden by default and reveal only for their actual focused block", () => {
  for (const color of [1, 2] as const) {
    const game = scene(color, [[4, 5], [5, 5], [7, 6], [3, 14], [5, 14]]);
    for (const [x, y] of [[11, 11], [13, 12], [13, 3], [15, 3]]) game.board[point(x, y)] = (3 - color) as Color;
    const states = new Map<string, ConnectionState>();
    const local = `${color}:${point(5, 5)}:${point(7, 6)}`;
    const distant = `${3 - color}:${point(11, 11)}:${point(13, 12)}`;
    updateConnections(game, states, 0, false);
    assert.equal(states.get(local)!.link.kind, "knight");
    assert.equal(states.get(local)!.toVisibility, 0);
    assert.equal(states.get(distant)!.toVisibility, 0);
    const tone = [...states.get(local)!.to];
    updateConnections(game, states, 1, true, point(4, 5));
    assert.equal(states.get(local)!.toVisibility, 1);
    assert.equal(states.get(distant)!.toVisibility, 0);
    assert.deepEqual(states.get(local)!.to, tone);
    assert.equal(states.get(`${color}:${point(3, 14)}:${point(5, 14)}`)!.toVisibility, 1);
    assert.equal(states.get(`${3 - color}:${point(13, 3)}:${point(15, 3)}`)!.toVisibility, 1);
    const amount = sampleVisibility(states.get(local)!, 1.2);
    updateConnections(game, states, 1.2, true, -1);
    assert.equal(sampleVisibility(states.get(local)!, 1.2), amount);
    assert.equal(states.get(local)!.toVisibility, 0);
    assert.deepEqual(states.get(local)!.to, tone);
  }
});

test("a focused knight yields only its local opposing crossing; it does not suppress that contact by default", () => {
  for (const color of [1, 2] as const) {
    const game = scene(color, [[7, 8], [8, 8], [10, 9]]);
    game.board[point(9, 8)] = game.board[point(9, 10)] = (3 - color) as Color;
    const states = new Map<string, ConnectionState>();
    const knight = `${color}:${point(8, 8)}:${point(10, 9)}`;
    const jump = `${3 - color}:${point(9, 8)}:${point(9, 10)}`;
    updateConnections(game, states, 0, false);
    assert.equal(states.get(knight)!.toVisibility, 0);
    assert.equal(states.get(jump)!.toVisibility, 1);
    updateConnections(game, states, 1, false, point(7, 8));
    assert.equal(states.get(knight)!.toVisibility, 1);
    assert.equal(states.get(jump)!.toVisibility, 0);
    assert.equal(states.get(knight)!.to[3], 0);
    assert.equal(states.get(jump)!.to[3], 0);
  }
});

test("an unproven knight cannot retire a weaker jump as an alternate connection", () => {
  for (const color of [1, 2] as const) {
    const game = scene(color, [[5, 5], [6, 5], [8, 5], [8, 6]]);
    const jump: Link = { i: point(5, 5), j: point(8, 5), color, kind: "large", threatened: false };
    const knight: Link = { i: point(6, 5), j: point(8, 6), color, kind: "knight", threatened: false };
    assert.equal(redundantJumps(game, [jump, knight], link => link.kind === "knight" ? .52 : .39).has(jump), false);
  }
});
