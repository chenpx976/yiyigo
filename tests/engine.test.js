import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Go, parseSGF, links } from "../dist/engine.js";
test("shared liberties are unique and capture removes entire group", () => {
  let g = new Go(9);
  g.board[10] = g.board[11] = 2;
  assert.equal(g.group(10).liberties.size, 6);
  for (let i of [1, 2, 9, 12, 19]) g.board[i] = 1;
  assert.equal(g.play(20), null);
  assert.equal(g.board[10], 0);
  assert.equal(g.board[11], 0);
  assert.equal(g.captures[1], 2);
  g.undo();
  assert.equal(g.board[10], 2);
  assert.equal(g.captures[1], 0);
});
test("suicide rejected without changing state", () => {
  let g = new Go(9);
  for (let i of [1, 9, 11, 19]) g.board[i] = 2;
  let b = g.board.slice();
  assert.match(g.play(10), /禁入/);
  assert.deepEqual(g.board, b);
  assert.equal(g.history.length, 0);
});
test("ko rejects recapture, undo restores board", () => {
  let g = new Go(9);
  for (let i of [1, 9, 19]) g.board[i] = 1;
  for (let i of [10, 2, 12, 20]) g.board[i] = 2;
  assert.equal(g.play(11), null);
  let b = g.board.slice();
  assert.match(g.play(10), /打劫/);
  assert.deepEqual(g.board, b);
});
test("two passes end and undo resumes", () => {
  let g = new Go();
  g.play(null);
  g.play(null);
  assert.equal(g.ended, true);
  g.undo();
  assert.equal(g.ended, false);
  assert.equal(g.passes, 1);
});
test("jump connections blocked by intervening stones", () => {
  let g = new Go();
  g.board[0] = g.board[2] = 1;
  assert.equal(links(g)[0].kind, "small");
  g.board[1] = 2;
  assert.equal(links(g).length, 0);
  g.board.fill(0);
  g.board[0] = g.board[3] = 1;
  assert.equal(links(g)[0].kind, "large");
});
test("SGF handles branches, escaped comments and passes", () => {
  let k = parseSGF("(;SZ[9]C[ignore ;B[aa\\] text];B[bb](;W[cc];B[])(;W[dd]))");
  assert.deepEqual(k.moves, [
    { color: 1, i: 10 },
    { color: 2, i: 20 },
    { color: 1, i: null },
  ]);
});
for (let file of ["cho", "gu", "lee"])
  test(`full champion replay: ${file}`, () => {
    let k = parseSGF(readFileSync(`dist/games/${file}.sgf`, "utf8")),
      g = new Go(k.n),
      metrics = [];
    for (let [index, m] of k.moves.entries()) {
      assert.equal(g.play(m.i, m.color), null, `move ${index + 1}`);
      if ([49, 99, 149, k.moves.length - 1].includes(index)) {
        let ls = links(g);
        metrics.push({
          move: index + 1,
          stones: g.board.filter(Boolean).length,
          solid: ls.filter((l) => l.kind === "solid").length,
          virtual: ls.filter((l) => l.kind !== "solid").length,
        });
      }
      for (let i = 0; i < g.board.length; i++)
        if (g.board[i]) assert.ok(g.group(i).liberties.size > 0);
    }
    console.log(file, k.moves.length, JSON.stringify(metrics));
  });

test("diagonals keep separate liberties and show cutting pressure", () => {
  const g = new Go();
  g.board[10] = g.board[20] = 1;
  assert.equal(g.group(10).stones.size, 1);
  assert.equal(g.group(10).liberties.size, 4);
  assert.equal(links(g)[0].kind, "diagonal");
  assert.equal(links(g)[0].threatened, false);
  g.board[11] = 2;
  assert.equal(links(g)[0].threatened, true);
  g.board[19] = 2;
  assert.equal(links(g).filter((l) => l.color === 1).length, 0);
});
test("capture preview is legal, deduplicated and does not mutate live game", async () => {
  const { analyzeMove } = await import("../dist/engine.js");
  let g = new Go();
  g.board[10] = g.board[11] = 2;
  for (let p of [1, 2, 9, 12, 19]) g.board[p] = 1;
  let before = JSON.stringify(g);
  let preview = analyzeMove(g, 20);
  assert.deepEqual(preview.captured, [10, 11]);
  assert.equal(preview.error, null);
  assert.equal(JSON.stringify(g), before);
  assert.equal(g.play(20), null);
  assert.equal(g.captures[1], preview.captured.length);
});
test("atari preview identifies targets and self-atari accurately", async () => {
  const { analyzeMove } = await import("../dist/engine.js");
  let g = new Go();
  g.board[10] = 2;
  g.board[1] = g.board[9] = 1;
  assert.deepEqual(analyzeMove(g, 11).atari, [10]);
  g = new Go();
  g.board[1] = g.board[9] = g.board[11] = 2;
  assert.equal(analyzeMove(g, 10).liberties, 1);
  g.board[19] = 2;
  assert.match(analyzeMove(g, 10).error, /禁入/);
});
