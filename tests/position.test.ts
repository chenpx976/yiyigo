import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Go, analyzeMove, parseSGF } from "../src/engine.ts";
import {
  chooseMove,
  geography,
  influence,
  openingValue,
} from "../src/position.ts";
test("corners borrow two edges but liberties remain physical", () => {
  let g = new Go(19);
  g.play(0);
  assert.equal(g.group(0).liberties.size, 2);
  assert.equal(geography(2 * 19 + 2, 19).edges.length, 2);
  assert.equal(geography(2 * 19 + 9, 19).edges.length, 1);
  assert.equal(geography(9 * 19 + 9, 19).edges.length, 0);
  assert.match(geography(0, 19).note, /偏低/);
});
test("nineteen line opening prefers spacious 3/4-line corner, nine permits centre", () => {
  const g = new Go(19);
  const best = chooseMove(g)!;
  const x = best % 19,
    y = Math.floor(best / 19);
  assert.ok([2, 3, 15, 16].includes(x) && [2, 3, 15, 16].includes(y));
  assert.ok(openingValue(g, 2 * 19 + 2) > openingValue(g, 0));
  const small = new Go(9);
  assert.equal(openingValue(small, 40), openingValue(small, 20));
});
test("saving a chain in atari outranks opening in an empty corner", () => {
  const g = new Go(19);
  g.board[20] = g.board[21] = 2;
  for (const p of [1, 2, 19, 22, 39]) g.board[p] = 1;
  g.turn = 2;
  const move = chooseMove(g);
  assert.equal(move, 40);
  const a = analyzeMove(g, 40);
  assert.equal(a.rescued.length, 2);
  assert.ok(a.liberties > 1);
});
test("bot captures when legal and never mutates the current game", () => {
  const g = new Go(9);
  g.board[10] = g.board[11] = 2;
  for (const p of [1, 2, 9, 12, 19]) g.board[p] = 1;
  const before = JSON.stringify(g);
  assert.equal(chooseMove(g), 20);
  assert.equal(JSON.stringify(g), before);
});
test("true eyes are not filled gratuitously", () => {
  const g = new Go(9);
  for (const p of [1, 9, 11, 19, 0, 2, 18, 20]) g.board[p] = 1;
  assert.notEqual(chooseMove(g), 10);
});
test("influence empty and opposite symmetry, bounded and finite", () => {
  const g = new Go();
  assert.ok(influence(g).every((x) => x === 0));
  g.board[38] = 1;
  g.board[42] = 2;
  const field = influence(g);
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < 9; x++) {
      assert.ok(Math.abs(field[y * 9 + x] + field[y * 9 + 8 - x]) < 1e-6);
      assert.ok(Math.abs(field[y * 9 + x]) <= 1);
    }
  assert.equal(field[40], 0);
});
test("all real-record checkpoints yield legal bot responses without state changes", () => {
  for (const file of ["cho", "gu", "lee"]) {
    const k = parseSGF(readFileSync(`public/games/${file}.sgf`, "utf8")),
      g = new Go(19);
    for (const [index, m] of k.moves.entries()) {
      g.play(m.i, m.color);
      if ([49, 99, 149, k.moves.length - 1].includes(index)) {
        const before = JSON.stringify(g),
          candidate = chooseMove(g);
        assert.equal(JSON.stringify(g), before);
        if (candidate !== null)
          assert.equal(analyzeMove(g, candidate).error, null);
        assert.ok(influence(g).every(Number.isFinite));
      }
    }
  }
});
