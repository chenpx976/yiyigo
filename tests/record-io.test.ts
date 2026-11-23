import test from "node:test";
import assert from "node:assert/strict";
import { Go, gameFromKifu, parseSGF } from "../src/engine.ts";
import { RecordLoader, restoreSavedGame, serializeSGF, validateRecord } from "../src/record-io.ts";

const setupRecord = "(;SZ[9]AB[aa][cc]AW[ii]PL[W]KM[0.5]HA[2]PB[Black]PW[White]DT[2026-01-01]EV[Test]RE[W+R];W[dd];B[ee];W[])";

test("SGF exports setup, turn, metadata and exactly the displayed prefix", () => {
  const source = parseSGF(setupRecord);
  for (const count of [0, 1, 2, 3]) {
    const game = gameFromKifu(source);
    for (const move of source.moves.slice(0, count)) assert.equal(game.play(move.i, move.color), null);
    const exported = validateRecord(serializeSGF(game, source.root));
    assert.deepEqual(exported.setup, source.setup);
    assert.equal(exported.toPlay, 2);
    assert.deepEqual(exported.moves, source.moves.slice(0, count));
    for (const key of ["KM", "HA", "PB", "PW", "DT", "EV", "RE"])
      assert.deepEqual(exported.root[key], source.root[key]);
    const replay = gameFromKifu(exported);
    for (const move of exported.moves) assert.equal(replay.play(move.i, move.color), null);
    assert.deepEqual(replay, game);
  }
});

test("exporting after capture and undo retains the original setup", () => {
  const source = parseSGF("(;SZ[9]AB[ba]AW[aa]PL[B];B[ab];W[cc];B[dd])");
  const game = gameFromKifu(source);
  for (const move of source.moves) assert.equal(game.play(move.i, move.color), null);
  assert.equal(game.board[0], 0);
  assert.equal(game.captures[1], 1);
  game.undo();
  const exported = validateRecord(serializeSGF(game, source.root));
  assert.deepEqual(exported.moves, source.moves.slice(0, 2));
  assert.deepEqual(exported.setup, source.setup);
});

test("root moves are exported once and root strings round-trip SGF escaping", () => {
  const source = parseSGF("(;SZ[9]B[aa];W[bb])");
  source.root.C = ["A ] bracket, \\ slash, ;B[cc] and 中文\nsecond line"];
  source.root.PB = ["Player \\] one"];
  const game = gameFromKifu(source);
  for (const move of source.moves) assert.equal(game.play(move.i, move.color), null);
  const exported = validateRecord(serializeSGF(game, source.root));
  assert.deepEqual(exported.moves, source.moves);
  assert.deepEqual(exported.root.C, source.root.C);
  assert.deepEqual(exported.root.PB, source.root.PB);
  assert.equal(exported.root.B, undefined);
  assert.equal(exported.root.CA[0], "UTF-8");
});

test("local export retains an empty white-to-play position and two ending passes", () => {
  const game = new Go(13);
  game.turn = 2;
  assert.equal(parseSGF(serializeSGF(game)).toPlay, 2);
  assert.equal(game.play(null), null);
  assert.equal(game.play(null), null);
  const restored = restoreSavedGame(JSON.stringify({ sgf: serializeSGF(game), opponent: "bot" }));
  assert.deepEqual(restored?.game, game);
  assert.equal(restored?.opponent, "bot");
  assert.equal(restored?.game.ended, true);
});

test("saved SGF restores setup and pending bot turn; legacy saves restore as human", () => {
  const source = parseSGF(setupRecord);
  const game = gameFromKifu(source);
  for (const move of source.moves.slice(0, 2)) assert.equal(game.play(move.i, move.color), null);
  const restored = restoreSavedGame(JSON.stringify({ sgf: serializeSGF(game), opponent: "bot" }));
  assert.deepEqual(restored?.game, game);
  assert.equal(restored?.game.turn, 2);
  assert.equal(restored?.opponent, "bot");
  const legacy = restoreSavedGame(JSON.stringify({ n: 9, moves: [{ i: 0, color: 1 }] }));
  assert.equal(legacy?.game.board[0], 1);
  assert.equal(legacy?.game.turn, 2);
  assert.equal(legacy?.opponent, "human");
  assert.equal(restoreSavedGame(null), null);
});

test("invalid saves and illegal records fail without accepting a partial replay", () => {
  for (const data of [
    { n: 8, moves: [] }, { n: 9, moves: [{ i: 0 }] },
    { n: 9, moves: [{ i: 0, color: 3 }] },
    { n: 9, moves: [{ i: 0, color: 1 }, { i: 0, color: 2 }] },
    { sgf: "(;SZ[9];B[aa];W[aa])" }, { sgf: "(;SZ[9])", opponent: "unknown" },
  ]) assert.throws(() => restoreSavedGame(JSON.stringify(data)));
  assert.throws(() => validateRecord("(;SZ[9];B[aa];W[aa])"), /第 2 手/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("a later file import wins over an earlier file success or failure", async () => {
  for (const outcome of ["success", "read error", "parse error"]) {
    const loader = new RecordLoader();
    const old = deferred<string>(), latest = deferred<string>();
    const applied: number[] = [], errors: unknown[] = [];
    const first = loader.load(() => old.promise, k => applied.push(k.n), e => errors.push(e));
    const second = loader.load(() => latest.promise, k => applied.push(k.n), e => errors.push(e));
    latest.resolve("(;SZ[13])");
    await second;
    if (outcome === "read error") old.reject(Error("obsolete file read"));
    else old.resolve(outcome === "parse error" ? "invalid SGF" : "(;SZ[9])");
    await first;
    assert.deepEqual(applied, [13]);
    assert.deepEqual(errors, []);
  }
});

test("a file import aborts a built-in fetch and suppresses its delayed body result", async () => {
  const loader = new RecordLoader(), body = deferred<string>();
  let signal!: AbortSignal;
  const applied: number[] = [], errors: unknown[] = [];
  const fetchLoad = loader.load(async received => {
    signal = received;
    return body.promise;
  }, k => applied.push(k.n), e => errors.push(e));
  assert.equal(signal.aborted, false);
  await loader.load(async () => "(;SZ[19])", k => applied.push(k.n), e => errors.push(e));
  assert.equal(signal.aborted, true);
  body.resolve("(;SZ[9])");
  await fetchLoad;
  assert.deepEqual(applied, [19]);
  assert.deepEqual(errors, []);
});

test("built-in fetch replacement suppresses old HTTP errors, including after leaving review", async () => {
  const loader = new RecordLoader(), response = deferred<{ ok: boolean }>();
  const errors: unknown[] = [], applied: number[] = [];
  const first = loader.load(async () => {
    const result = await response.promise;
    if (!result.ok) throw Error("棋谱读取失败");
    return "(;SZ[9])";
  }, k => applied.push(k.n), e => errors.push(e));
  await loader.load(async () => "(;SZ[13])", k => applied.push(k.n), e => errors.push(e));
  loader.cancel();
  response.resolve({ ok: false });
  await first;
  assert.deepEqual(applied, [13]);
  assert.deepEqual(errors, []);
});

test("cancel ignores late success and failure even when the source cannot abort", async () => {
  for (const fail of [false, true]) {
    const loader = new RecordLoader(), pending = deferred<string>();
    const callbacks: unknown[] = [];
    const task = loader.load(() => pending.promise, k => callbacks.push(k), e => callbacks.push(e));
    loader.cancel();
    if (fail) pending.reject(Error("late error"));
    else pending.resolve("(;SZ[9])");
    await task;
    assert.deepEqual(callbacks, []);
  }
});

test("current read and validation errors are surfaced and the next load can succeed", async () => {
  const loader = new RecordLoader(), errors: unknown[] = [], applied: number[] = [];
  await loader.load(async () => { throw Error("current read failed"); }, k => applied.push(k.n), e => errors.push(e));
  await loader.load(async () => "(;SZ[9];B[aa];W[aa])", k => applied.push(k.n), e => errors.push(e));
  await loader.load(async () => "(;SZ[9])", k => applied.push(k.n), e => errors.push(e));
  assert.equal(errors.length, 2);
  assert.match(String(errors[0]), /current read failed/);
  assert.match(String(errors[1]), /第 2 手/);
  assert.deepEqual(applied, [9]);
});
