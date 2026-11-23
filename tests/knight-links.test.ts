import test from "node:test";
import assert from "node:assert/strict";
import { Go, links } from "../src/engine";
import type { Color, Link } from "../src/engine";
import { linkRoutes, linkRoutePoints } from "../src/link-pattern";

const n = 19;
const point = (x: number, y: number) => y * n + x;
const key = (i: number, j: number) => [Math.min(i, j), Math.max(i, j)];
const find = (g: Go, i: number, j: number) => {
  const [a, b] = key(i, j);
  return links(g).find((link) => link.i === a && link.j === b);
};
const scene = (color: Color, x = 9, y = 9) => {
  const game = new Go(n), i = point(x, y), j = point(x + 2, y + 1);
  game.board[i] = game.board[j] = color;
  return { game, i, j };
};
const transform = (i: number, symmetry: number) => {
  let x = i % n, y = Math.floor(i / n);
  if (symmetry >= 4) x = n - 1 - x;
  for (let turn = 0; turn < symmetry % 4; turn++) [x, y] = [n - 1 - y, x];
  return point(x, y);
};

test("knight routes are the three integer paths, with no shared liberty invented", () => {
  const { game, i, j } = scene(1), link = find(game, i, j)!;
  assert.equal(link.kind, "knight");
  assert.equal(link.threatened, false);
  assert.deepEqual(linkRoutes(n, link), [
    [point(10, 9), point(11, 9)],
    [point(10, 9), point(10, 10)],
    [point(9, 10), point(10, 10)],
  ]);
  assert.equal(game.group(i).stones.size, 1);
  assert.equal(game.group(j).stones.size, 1);
  assert.equal(game.group(i).liberties.size, 4);
  assert.equal(game.group(j).liberties.size, 4);
  assert.equal([...game.group(i).liberties].filter(p => game.group(j).liberties.has(p)).length, 0);
});

test("knight recognition and routes preserve all eight symmetries, colors and board edges", () => {
  for (const color of [1, 2] as const) for (const [x, y] of [[9, 9], [0, 0], [0, 8]]) {
    const source = scene(color, x, y), original = find(source.game, source.i, source.j)!;
    for (let symmetry = 0; symmetry < 8; symmetry++) {
      const game = new Go(n), i = transform(source.i, symmetry), j = transform(source.j, symmetry);
      game.board[i] = game.board[j] = color;
      const link = find(game, i, j)!;
      assert.equal(link.kind, "knight");
      assert.equal(link.color, color);
      const expected = linkRoutePoints(n, original).map(p => transform(p, symmetry)).sort((a, b) => a - b);
      assert.deepEqual(linkRoutePoints(n, link).sort((a, b) => a - b), expected);
      for (const route of linkRoutes(n, link)) {
        assert.equal(route.length, 2);
        const sequence = [link.i, ...route, link.j];
        for (const p of sequence) assert.ok(Number.isInteger(p) && p >= 0 && p < n * n);
        for (let k = 1; k < sequence.length; k++) assert.ok(game.neighbors(sequence[k - 1]).includes(sequence[k]));
      }
      assert.deepEqual(linkRoutePoints(n, { ...link, i: link.j, j: link.i }).sort((a, b) => a - b), expected);
    }
  }
});

test("each single knight-corridor intrusion threatens but never alone erases the candidate", () => {
  for (const color of [1, 2] as const) for (const [x, y] of [[9, 9], [0, 0]]) {
    const original = scene(color, x, y), route = linkRoutePoints(n, find(original.game, original.i, original.j)!);
    for (const cut of route) for (let symmetry = 0; symmetry < 8; symmetry++) {
      const game = new Go(n), i = transform(original.i, symmetry), j = transform(original.j, symmetry);
      game.board[i] = game.board[j] = color;
      game.board[transform(cut, symmetry)] = (3 - color) as Color;
      const before = game.board.slice(), link = find(game, i, j)!;
      assert.equal(link.kind, "knight");
      assert.equal(link.threatened, true);
      assert.deepEqual(game.board, before);
    }
  }
});

test("only a complete local route block removes a knight candidate, including asymmetric cuts", () => {
  // a,b are the upper corridor points; c,d the lower ones. The three
  // minimal block sets are {a,c}, {a,d}, {b,d}; {b,c} leaves the middle route.
  const corridor = [point(10, 9), point(11, 9), point(9, 10), point(10, 10)];
  for (const color of [1, 2] as const) for (let mask = 0; mask < 16; mask++) for (let symmetry = 0; symmetry < 8; symmetry++) {
    const source = scene(color), game = new Go(n), i = transform(source.i, symmetry), j = transform(source.j, symmetry);
    game.board[i] = game.board[j] = color;
    corridor.forEach((p, k) => { if (mask & (1 << k)) game.board[transform(p, symmetry)] = (3 - color) as Color; });
    const blocked = (mask & 5) === 5 || (mask & 9) === 9 || (mask & 10) === 10;
    const link = find(game, i, j);
    assert.equal(!!link, !blocked, `color=${color}, mask=${mask}, symmetry=${symmetry}`);
    if (link) assert.equal(link.threatened, mask !== 0);
  }
});

test("friendly intervening stones and existing real chains do not invent duplicate virtual links", () => {
  for (const color of [1, 2] as const) {
    const { game, i, j } = scene(color);
    game.board[point(10, 9)] = color;
    assert.equal(find(game, i, j)?.kind, "knight");
    game.board[point(10, 10)] = color;
    assert.ok(game.group(i).stones.has(j));
    assert.equal(find(game, i, j), undefined);
    const other = scene(color);
    for (const [x, y] of [[8, 9], [8, 10], [8, 11], [9, 11], [10, 11], [11, 11]]) other.game.board[point(x, y)] = color;
    assert.ok(other.game.group(other.i).stones.has(other.j));
    assert.equal(find(other.game, other.i, other.j), undefined);
  }
});

test("atari at both knight endpoints preserves a threatened shape candidate and separate liberties", () => {
  for (const color of [1, 2] as const) {
    const { game, i, j } = scene(color);
    for (const [x, y] of [[8, 9], [9, 8], [9, 10], [12, 10], [11, 11], [11, 9]]) game.board[point(x, y)] = (3 - color) as Color;
    assert.equal(game.group(i).liberties.size, 1);
    assert.equal(game.group(j).liberties.size, 1);
    assert.equal(find(game, i, j)?.kind, "knight");
    assert.equal(find(game, i, j)?.threatened, true);
    assert.notDeepEqual([...game.group(i).liberties], [...game.group(j).liberties]);
  }
});

test("a cut and fast undo restore the same knight candidate without mutating rule state", () => {
  for (const color of [1, 2] as const) {
    const { game, i, j } = scene(color), initial = game.board.slice();
    const before = find(game, i, j);
    assert.equal(game.play(point(10, 9), (3 - color) as Color), null);
    assert.equal(find(game, i, j)?.threatened, true);
    assert.equal(game.play(point(10, 10), (3 - color) as Color), null);
    assert.equal(find(game, i, j), undefined);
    game.undo(); assert.equal(find(game, i, j)?.threatened, true);
    game.undo(); assert.deepEqual(find(game, i, j), before);
    assert.deepEqual(game.board, initial);
  }
});

test("route helper keeps the existing solid, diagonal and straight-jump contracts", () => {
  const i = point(9, 9);
  const examples: [Link["kind"], number, number[][]][] = [
    ["solid", point(10, 9), [[]]],
    ["diagonal", point(10, 10), [[point(10, 9)], [point(9, 10)]]],
    ["small", point(11, 9), [[point(10, 9)]]],
    ["large", point(9, 12), [[point(9, 10), point(9, 11)]]],
  ];
  for (const [kind, j, expected] of examples) assert.deepEqual(linkRoutes(n, { i, j, kind }), expected);
});
