import test from "node:test";
import assert from "node:assert/strict";
import { Go } from "../src/engine";
import { influenceField } from "../src/influence";
import { influence } from "../src/position";

const channels = ["black", "white", "advantage", "total", "contest"] as const;
const at = (x: number, y: number, n = 19) => y * n + x;
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

function mixedBoard() {
  const game = new Go(19);
  for (const [x, y] of [[0, 0], [0, 1], [5, 4], [6, 4], [9, 8], [16, 17]])
    game.board[at(x, y)] = 1;
  for (const [x, y] of [[1, 0], [5, 6], [8, 9], [9, 10], [18, 18]])
    game.board[at(x, y)] = 2;
  return game;
}

test("empty boards have no influence, including edges and corners", () => {
  for (const n of [1, 9, 13, 19]) {
    const field = influenceField(new Go(n));
    assert.equal(field.n, n);
    for (const key of channels) {
      assert.ok(field[key] instanceof Float32Array);
      assert.equal(field[key].length, n * n);
      assert.ok(field[key].every((value) => value === 0));
    }
  }
});

test("balanced confrontation retains presence while open space has none", () => {
  const game = new Go(19);
  for (let y = 7; y <= 11; y++) {
    game.board[at(8, y)] = 1;
    game.board[at(10, y)] = 2;
  }
  const field = influenceField(game);
  const centre = at(9, 9);
  close(field.advantage[centre], 0);
  assert.ok(field.total[centre] > 0.7);
  close(field.contest[centre], field.total[centre]);
  assert.ok(field.total[at(0, 0)] < 0.01);
  assert.equal(influenceField(new Go(19)).total[centre], 0);
});

test("an occupied opposing wall blocks propagation, and an opening admits it", () => {
  const game = new Go(19);
  game.board[at(6, 9)] = 1;
  for (let y = 0; y < 19; y++) game.board[at(9, y)] = 2;
  const blocked = influenceField(game);
  assert.ok(blocked.black[at(8, 9)] > 0);
  for (let y = 0; y < 19; y++)
    for (let x = 9; x < 19; x++)
      assert.equal(blocked.black[at(x, y)], 0);
  game.board[at(9, 9)] = 0;
  assert.ok(influenceField(game).black[at(10, 9)] > 0);
});

test("exchanging colours exchanges channels without changing contested presence", () => {
  const game = mixedBoard();
  const exchanged = new Go(19);
  exchanged.board = game.board.map((c) => (c === 1 ? 2 : c === 2 ? 1 : 0));
  const a = influenceField(game);
  const b = influenceField(exchanged);
  for (let i = 0; i < game.board.length; i++) {
    close(a.black[i], b.white[i]);
    close(a.white[i], b.black[i]);
    close(a.advantage[i], -b.advantage[i]);
    close(a.total[i], b.total[i]);
    close(a.contest[i], b.contest[i]);
  }
});

test("rotation and reflection preserve influence, including the boundary", () => {
  const game = mixedBoard();
  const original = influenceField(game);
  for (const transform of [
    (x: number, y: number) => at(18 - y, x),
    (x: number, y: number) => at(18 - x, y),
  ]) {
    const changed = new Go(19);
    game.board.forEach((c, i) => { changed.board[transform(i % 19, Math.floor(i / 19))] = c; });
    const transformed = influenceField(changed);
    for (let i = 0; i < game.board.length; i++) {
      const j = transform(i % 19, Math.floor(i / 19));
      for (const key of channels) close(original[key][i], transformed[key][j]);
    }
  }
});

test("channels stay bounded and do not classify an atari stone as dead", () => {
  const game = mixedBoard();
  // Tighten the top-left chain to one liberty; it must remain a source.
  assert.equal(game.group(at(0, 0)).liberties.size, 2);
  game.board[at(1, 1)] = 2;
  assert.equal(game.group(at(0, 0)).liberties.size, 1);
  const atariBefore = JSON.stringify(game);
  const field = influenceField(game);
  assert.equal(field.black[at(0, 0)], 1);
  assert.equal(field.white[at(0, 0)], 0);
  assert.equal(JSON.stringify(game), atariBefore);
  for (let i = 0; i < game.board.length; i++) {
    for (const key of channels) assert.ok(Number.isFinite(field[key][i]));
    assert.ok(field.black[i] >= 0 && field.black[i] <= 1);
    assert.ok(field.white[i] >= 0 && field.white[i] <= 1);
    assert.ok(field.total[i] <= 1 + 1e-6);
    assert.ok(Math.abs(field.advantage[i]) <= field.total[i] + 1e-6);
    assert.ok(field.contest[i] >= 0 && field.contest[i] <= field.total[i] + 1e-6);
  }
  assert.deepEqual(influence(game), field.advantage);
});

test("iteration requests are bounded and deterministic", () => {
  const game = mixedBoard();
  assert.deepEqual(influenceField(game, 10000), influenceField(game, 64));
  assert.deepEqual(influenceField(game, Number.NaN), influenceField(game));
  assert.deepEqual(influenceField(game, -1), influenceField(game, 0));
});
